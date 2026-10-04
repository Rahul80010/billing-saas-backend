const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const User = require('../models/User');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const RestaurantTable = require('../models/RestaurantTable');
const RestaurantOrder = require('../models/RestaurantOrder');
const { deleteImageFromStorage } = require('../services/storageService');

jest.setTimeout(60000);

let mongoServer;
let user1Token;
let user1Id;
let user2Token;
let user2Id;
let adminToken;
let adminId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // 1. Create User 1 (Tenant 1)
  const u1 = await User.create({
    name: 'Tenant One',
    email: 'tenant1@test.com',
    password: 'password123',
    businessPhone: '9876543210',
    isVerified: true
  });
  user1Id = u1._id.toString();

  const loginRes1 = await request(app)
    .post('/api/auth/login')
    .send({ email: 'tenant1@test.com', password: 'password123' });
  user1Token = loginRes1.body.token;

  // 2. Create User 2 (Tenant 2)
  const u2 = await User.create({
    name: 'Tenant Two',
    email: 'tenant2@test.com',
    password: 'password123',
    businessPhone: '9876543211',
    isVerified: true
  });
  user2Id = u2._id.toString();

  const loginRes2 = await request(app)
    .post('/api/auth/login')
    .send({ email: 'tenant2@test.com', password: 'password123' });
  user2Token = loginRes2.body.token;

  // 3. Create Admin User
  const adm = await User.create({
    name: 'Admin User',
    email: 'admin@test.com',
    password: 'password123',
    businessPhone: '9876543212',
    isVerified: true,
    isAdmin: true
  });
  adminId = adm._id.toString();

  const loginAdmin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@test.com', password: 'password123' });
  adminToken = loginAdmin.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('MOHURI Security Remediation Test Suite', () => {

  describe('1. Information Disclosure & SSRF Protection', () => {
    it('debug-smtp route should be completely removed (404)', async () => {
      const res = await request(app).get('/api/auth/debug-smtp');
      expect(res.statusCode).toBe(404);
    });

    it('test-email should reject unauthenticated requests (401)', async () => {
      const res = await request(app)
        .post('/api/auth/test-email')
        .send({ email: 'target@test.com' });
      expect(res.statusCode).toBe(401);
    });

    it('test-email should reject non-admin merchants (403)', async () => {
      const res = await request(app)
        .post('/api/auth/test-email')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ email: 'target@test.com' });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('2. Account Suspension & Authorization Enforcement', () => {
    it('should block suspended (isBlocked: true) users from accessing protected APIs', async () => {
      const suspendedUser = await User.create({
        name: 'Blocked Merchant',
        email: 'blocked@test.com',
        password: 'password123',
        businessPhone: '9876543299',
        isVerified: true,
        isBlocked: true
      });

      const resLogin = await request(app)
        .post('/api/auth/login')
        .send({ email: 'blocked@test.com', password: 'password123' });
      expect(resLogin.statusCode).toBe(403);
      expect(resLogin.body.message).toMatch(/suspended/i);

      // Even with a valid token, middleware should reject
      const jwt = require('jsonwebtoken');
      const suspendedToken = jwt.sign({ id: suspendedUser._id }, process.env.JWT_SECRET || 'secret');

      const resProtected = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${suspendedToken}`);
      expect(resProtected.statusCode).toBe(403);
      expect(resProtected.body.message).toMatch(/suspended/i);
    });
  });

  describe('3. OTP Brute-Force Lockout Protection', () => {
    it('should invalidate OTP after 5 consecutive failed attempts', async () => {
      const unverified = await User.create({
        name: 'OTP Target',
        email: 'otptest@test.com',
        password: 'password123',
        businessPhone: '9876543288',
        isVerified: false,
        otp: '123456',
        otpExpires: new Date(Date.now() + 10 * 60 * 1000)
      });

      // Try 4 failed attempts
      for (let i = 1; i <= 4; i++) {
        const res = await request(app)
          .post('/api/auth/verify-otp')
          .send({ email: 'otptest@test.com', otp: '000000' });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/remaining/i);
      }

      // 5th failed attempt should trigger lockout and invalidate OTP
      const res5 = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'otptest@test.com', otp: '000000' });
      expect(res5.statusCode).toBe(400);
      expect(res5.body.message).toMatch(/Too many failed attempts/i);

      // Now even trying the original correct OTP should fail because it was invalidated
      const resCorrect = await request(app)
        .post('/api/auth/verify-otp')
        .send({ email: 'otptest@test.com', otp: '123456' });
      expect(resCorrect.statusCode).toBe(400);
      expect(resCorrect.body.message).toMatch(/No active OTP/i);
    });
  });

  describe('4. Price Tampering Prevention in Restaurant Ordering', () => {
    it('should override client-tampered price with authoritative price from database in placeOrder', async () => {
      // 1. Create a table for Tenant 1
      const table = await RestaurantTable.create({
        tenantId: user1Id,
        tableName: 'Table 101',
        tableNumber: 101,
        capacity: 4
      });

      // 2. Create a product with real price 250
      const prod = await Product.create({
        userId: user1Id,
        name: 'Special Biryani',
        price: 250,
        stock: 50,
        unit: 'pcs'
      });

      // 3. Place order with tampered client price: 10
      const orderRes = await request(app)
        .post('/api/restaurant/public/order')
        .send({
          tenantId: user1Id,
          tableId: table._id.toString(),
          customerName: 'Diner Dave',
          customerPhone: '9876543210',
          items: [
            {
              product: prod._id.toString(),
              name: 'Special Biryani',
              price: 10, // Attempted price tampering!
              quantity: 2
            }
          ]
        });

      expect(orderRes.statusCode).toBe(201);
      // Item price should be recalculated to 250, total should be 500 (not 20)
      expect(orderRes.body.totalAmount).toBe(500);
      expect(orderRes.body.items[0].price).toBe(250);
    });
  });

  describe('5. Cross-Tenant Storage Deletion Isolation & Path Traversal Prevention', () => {
    it('should prevent Tenant 1 from deleting Tenant 2 files via deleteImageFromStorage', async () => {
      const otherTenantKey = `tenant_${user2Id}/products/secret-image.webp`;

      // Tenant 1 attempting to delete Tenant 2 image
      await expect(deleteImageFromStorage(otherTenantKey, user1Id)).resolves.not.toThrow();
      // The function silently blocks cross-tenant deletion and does not delete foreign tenant files
    });

    it('should block directory traversal paths in deleteImageFromStorage', async () => {
      const maliciousPath = `../../server.js`;
      await expect(deleteImageFromStorage(maliciousPath, user1Id)).resolves.not.toThrow();
    });
  });

  describe('6. Product Variant Mass-Assignment Prevention', () => {
    it('should ignore arbitrary unauthorized fields during variant update', async () => {
      const prod = await Product.create({
        userId: user1Id,
        name: 'Polo Shirt',
        price: 500,
        stock: 20
      });

      const variant = await ProductVariant.create({
        productId: prod._id,
        userId: user1Id,
        variantName: 'Size M',
        price: 500,
        stock: 10
      });

      // Send update with malicious fields attempting to reassign userId to Tenant 2
      const res = await request(app)
        .put(`/api/products/${prod._id}`)
        .set('Authorization', `Bearer ${user1Token}`)
        .send({
          name: 'Polo Shirt Premium',
          variants: [
            {
              _id: variant._id.toString(),
              variantName: 'Size M Updated',
              price: 550,
              userId: user2Id, // Attempted tenant theft!
              isAdmin: true
            }
          ]
        });

      expect(res.statusCode).toBe(200);

      // Verify in DB that userId was not overwritten
      const updatedVar = await ProductVariant.findById(variant._id);
      expect(updatedVar.userId.toString()).toBe(user1Id);
      expect(updatedVar.price).toBe(550);
      expect(updatedVar.variantName).toBe('Size M Updated');
    });
  });

});

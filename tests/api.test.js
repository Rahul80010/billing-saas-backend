const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');

jest.setTimeout(60000); // 60 seconds

let mongoServer;
let token;
let secondUserToken;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Register a test user
  await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123'
    });

  const User = mongoose.model('User');
  const user1 = await User.findOne({ email: 'test@example.com' });
  const verifyRes1 = await request(app)
    .post('/api/auth/verify-otp')
    .send({
      email: 'test@example.com',
      otp: user1.otp
    });
  token = verifyRes1.body.token;

  // Register a second test user to verify data isolation
  await request(app)
    .post('/api/auth/register')
    .send({
      name: 'Second User',
      email: 'second@example.com',
      password: 'password123'
    });

  const user2 = await User.findOne({ email: 'second@example.com' });
  const verifyRes2 = await request(app)
    .post('/api/auth/verify-otp')
    .send({
      email: 'second@example.com',
      otp: user2.otp
    });
  secondUserToken = verifyRes2.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('Authentication API', () => {
  it('should not register user with short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Short Pass',
        email: 'short@example.com',
        password: '123'
      });
    expect(res.statusCode).toEqual(400);
  });

  it('should login test user and return JWT token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'password123'
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('token');
  });

  it('should send reset OTP for forgot-password', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'test@example.com' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toBe('Password reset OTP sent to your email');
  });

  it('should reset password with correct OTP', async () => {
    const User = mongoose.model('User');
    const user = await User.findOne({ email: 'test@example.com' });
    
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({
        email: 'test@example.com',
        otp: user.resetPasswordOtp,
        newPassword: 'newpassword123'
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body.message).toBe('Password reset successful');

    // Confirm that we can login with the new password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'test@example.com',
        password: 'newpassword123'
      });
    expect(loginRes.statusCode).toEqual(200);
    expect(loginRes.body).toHaveProperty('token');
    // Restore original token so other tests run fine
    token = loginRes.body.token;
  });

  it('should return user info for me route when authenticated', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.email).toBe('test@example.com');
  });

  it('should fail me route when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toEqual(401);
  });
});

describe('Products API', () => {
  let productId;

  it('should fail to create product if not authenticated', async () => {
    const res = await request(app)
      .post('/api/products')
      .send({
        name: 'Unauthorized Product',
        price: 100,
        gst: 18
      });
    expect(res.statusCode).toEqual(401);
  });

  it('should create a new product when authenticated', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Product',
        price: 100,
        gst: 18
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.name).toBe('Test Product');
    productId = res.body._id;
  });

  it('should get products for the authenticated user only', async () => {
    // Check with first user (should find it)
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toBeGreaterThan(0);

    // Check with second user (should NOT find it - empty array)
    const resSecond = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(resSecond.statusCode).toEqual(200);
    expect(resSecond.body.length).toBe(0);
  });

  it('should update a product and handle 0 values correctly', async () => {
    const res = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        price: 0,
        gst: 0
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body.price).toBe(0);
    expect(res.body.gst).toBe(0);
  });

  it('should prevent updating other users products', async () => {
    const res = await request(app)
      .put(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .send({
        name: 'Hacked Product'
      });
    expect(res.statusCode).toEqual(404);
  });

  it('should delete a product', async () => {
    const res = await request(app)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
  });
});

describe('Customers API', () => {
  let customerId;

  it('should create a new customer', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Customer',
        phone: '1234567890'
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.name).toBe('Test Customer');
    customerId = res.body._id;
  });

  it('should get all customers for authenticated user', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toBeGreaterThan(0);

    const resSecond = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(resSecond.statusCode).toEqual(200);
    expect(resSecond.body.length).toBe(0);
  });

  it('should update a customer', async () => {
    const res = await request(app)
      .put(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '0987654321' });
    expect(res.statusCode).toEqual(200);
    expect(res.body.phone).toBe('0987654321');
  });

  it('should upsert customer with same phone and update name', async () => {
    const res1 = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Original Customer',
        phone: '9998887776'
      });
    expect(res1.statusCode).toBe(201);
    const originalId = res1.body._id;

    const res2 = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Updated Customer Name',
        phone: '9998887776'
      });
    
    expect(res2.statusCode).toBe(200);
    expect(res2.body._id).toBe(originalId);
    expect(res2.body.name).toBe('Updated Customer Name');

    await request(app)
      .delete(`/api/customers/${originalId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('should delete a customer', async () => {
    const res = await request(app)
      .delete(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
  });
});

describe('Bills API', () => {
  it('should return 400 if items array is not valid', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Test Customer',
        items: { productName: 'invalid' } // not an array
      });
    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toBe('No valid bill items provided');
  });

  it('should return 400 if item has negative price or quantity', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Test Customer',
        items: [
          { productName: 'Item 1', price: -10, quantity: 2, gst: 18 }
        ]
      });
    expect(res.statusCode).toEqual(400);
  });

  it('should create a bill and calculate total accurately', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Test Customer',
        items: [
          { productName: 'Item 1', price: 100, quantity: 2, gst: 18 }, // (100*2) + 18% = 200 + 36 = 236
          { productName: 'Item 2', price: 50, quantity: 1, gst: 5 }    // (50*1) + 5% = 50 + 2.5 = 52.5
        ]
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('_id');
    expect(res.body.total).toBe(288.5); // 236 + 52.5 = 288.5
  });

  it('should get all bills for the authenticated user only', async () => {
    const res = await request(app)
      .get('/api/bills')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toEqual(200);
    expect(res.body.length).toBeGreaterThan(0);

    const resSecond = await request(app)
      .get('/api/bills')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(resSecond.statusCode).toEqual(200);
    expect(resSecond.body.length).toBe(0);
  });

  it('should create a bill with customerPhone and support phone query parameter', async () => {
    const uniquePhone = '9990001112';
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Phone Filter Customer',
        customerPhone: uniquePhone,
        items: [
          { productName: 'Filter Product', price: 100, quantity: 1, gst: 10 }
        ]
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.customerPhone).toBe(uniquePhone);

    const queryRes = await request(app)
      .get(`/api/bills?phone=${uniquePhone}`)
      .set('Authorization', `Bearer ${token}`);
    
    expect(queryRes.statusCode).toBe(200);
    expect(queryRes.body.length).toBe(1);
    expect(queryRes.body[0].customerPhone).toBe(uniquePhone);
  });
});

describe('Real User Flow', () => {
  it('should create a product, customer, and then a bill', async () => {
    const prodRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Flow Product', price: 100, gst: 10 });
    const custRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Flow Customer', phone: '1112223334' });
    
    expect(prodRes.statusCode).toBe(201);
    expect(custRes.statusCode).toBe(201);

    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: custRes.body.name,
        items: [{
          productName: prodRes.body.name,
          price: prodRes.body.price,
          quantity: 3,
          gst: prodRes.body.gst
        }]
      });

    expect(billRes.statusCode).toBe(201);
    expect(billRes.body.total).toBe(330); // (100 * 3) + 10% = 330
  });
});

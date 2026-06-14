const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const Bill = require('../models/Bill');

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

  it('should create a bill with customerAddress and customer with address', async () => {
    const address = '123 Test Street, Delhi';
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Address Test Customer',
        customerPhone: '9990002222',
        customerAddress: address,
        items: [
          { productName: 'Address Product', price: 100, quantity: 1, gst: 10 }
        ]
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.customerAddress).toBe(address);

    const custRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Address Test Customer',
        phone: '9990002222',
        address: address
      });
    expect(custRes.statusCode).toBe(201);
    expect(custRes.body.address).toBe(address);
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

describe('User Profile API', () => {
  it('should update user business profile and whatsapp details', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        businessName: 'My Awesome Retail Store',
        whatsappToken: 'meta_fake_token_123',
        whatsappPhoneNumberId: '123456789012',
        businessAddress: '123 Test Ave',
        businessPhone: '+91 1111111111',
        gstin: '22GSTIN1234A1Z0',
        invoiceFooter: 'Mock Footer Note',
        whatsappBillTemplate: 'Custom bill template for {customerName} total: {total}',
        whatsappReminderTemplate: 'Custom reminder for {customerName} outstanding: {remainingAmount} invoice: {invoiceNo}'
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.businessName).toBe('My Awesome Retail Store');
    expect(res.body.whatsappToken).toBe('meta_fake_token_123');
    expect(res.body.whatsappPhoneNumberId).toBe('123456789012');
    expect(res.body.businessAddress).toBe('123 Test Ave');
    expect(res.body.businessPhone).toBe('+91 1111111111');
    expect(res.body.gstin).toBe('22GSTIN1234A1Z0');
    expect(res.body.invoiceFooter).toBe('Mock Footer Note');
    expect(res.body.whatsappBillTemplate).toBe('Custom bill template for {customerName} total: {total}');
    expect(res.body.whatsappReminderTemplate).toBe('Custom reminder for {customerName} outstanding: {remainingAmount} invoice: {invoiceNo}');

    // Verify 'me' endpoint returns these updated credentials
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meRes.statusCode).toBe(200);
    expect(meRes.body.businessName).toBe('My Awesome Retail Store');
    expect(meRes.body.whatsappToken).toBe('meta_fake_token_123');
    expect(meRes.body.whatsappPhoneNumberId).toBe('123456789012');
    expect(meRes.body.businessAddress).toBe('123 Test Ave');
    expect(meRes.body.businessPhone).toBe('+91 1111111111');
    expect(meRes.body.gstin).toBe('22GSTIN1234A1Z0');
    expect(meRes.body.invoiceFooter).toBe('Mock Footer Note');
    expect(meRes.body.whatsappBillTemplate).toBe('Custom bill template for {customerName} total: {total}');
    expect(meRes.body.whatsappReminderTemplate).toBe('Custom reminder for {customerName} outstanding: {remainingAmount} invoice: {invoiceNo}');
  });
});

describe('Bills Public PDF API', () => {
  it('should retrieve dynamically generated print invoice PDF without authentication', async () => {
    // Generate a temporary bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'PDF Test User',
        items: [
          { productName: 'PDF Item', price: 10, quantity: 5, gst: 10 }
        ]
      });
    expect(billRes.statusCode).toBe(201);
    const billId = billRes.body._id;

    // Fetch PDF dynamically (unprotected)
    const pdfRes = await request(app)
      .get(`/api/bills/${billId}/pdf`);
    
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.headers['content-type']).toBe('application/pdf');
    expect(pdfRes.headers['content-disposition']).toContain(`invoice_${billId.toString().slice(-6).toUpperCase()}.pdf`);
    expect(pdfRes.body).toBeInstanceOf(Buffer);
  });
});

describe('WhatsApp Test Connection API', () => {
  it('should return error if phone number is missing', async () => {
    const res = await request(app)
      .post('/api/auth/test-whatsapp')
      .set('Authorization', `Bearer ${token}`)
      .send({
        whatsappToken: 'some_token',
        whatsappPhoneNumberId: 'some_id'
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Please provide a target phone number');
  });

  it('should return success in sandbox mode if credentials are empty', async () => {
    const res = await request(app)
      .post('/api/auth/test-whatsapp')
      .set('Authorization', `Bearer ${token}`)
      .send({
        phone: '919876543210',
        whatsappToken: '',
        whatsappPhoneNumberId: ''
      });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Sandbox mode active');
  });
});

describe('Credit / Udhaar API', () => {
  let creditBillId;

  it('should create a bill with paymentType: Credit and correct credit fields', async () => {
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Credit Test Customer',
        customerPhone: '919999999999',
        paymentType: 'Credit',
        paidAmount: 50,
        dueDate: new Date(Date.now() + 86400000).toISOString(), // 1 day in future
        items: [
          { productName: 'Credit Item 1', price: 100, quantity: 2, gst: 18 } // Total = 200 + 36 = 236
        ]
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.paymentType).toBe('Credit');
    expect(res.body.total).toBe(236);
    expect(res.body.paidAmount).toBe(50);
    expect(res.body.remainingAmount).toBe(186);
    expect(res.body.status).toBe('partial');
    expect(res.body.dueDate).toBeDefined();
    expect(res.body.payments.length).toBe(1);
    expect(res.body.payments[0].amount).toBe(50);

    creditBillId = res.body._id;
  });

  it('should return credit stats containing the outstanding credit amount', async () => {
    const res = await request(app)
      .get('/api/bills/credit/stats')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.totalCreditOutstanding).toBe(186);
    expect(res.body.pendingCustomersCount).toBe(1);
  });

  it('should update remainingAmount and status when partial payment is recorded', async () => {
    const res = await request(app)
      .post(`/api/bills/${creditBillId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 86,
        note: 'Partial pay'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.paidAmount).toBe(136);
    expect(res.body.remainingAmount).toBe(100);
    expect(res.body.status).toBe('partial');
    expect(res.body.payments.length).toBe(2);
    expect(res.body.payments[1].amount).toBe(86);
    expect(res.body.payments[1].note).toBe('Partial pay');
  });

  it('should update status to paid when remainingAmount reaches 0', async () => {
    const res = await request(app)
      .post(`/api/bills/${creditBillId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 100,
        note: 'Final pay'
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.paidAmount).toBe(236);
    expect(res.body.remainingAmount).toBe(0);
    expect(res.body.status).toBe('paid');
    expect(res.body.payments.length).toBe(3);
    expect(res.body.payments[2].amount).toBe(100);
  });

  it('should prevent User B from viewing or paying off User A\'s credit bill (user data isolation)', async () => {
    // Attempt to view stats from second user token
    const statsRes = await request(app)
      .get('/api/bills/credit/stats')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.body.totalCreditOutstanding).toBe(0); // isolated user has no credit

    // Attempt to record payment on User A's bill with User B's token
    const payRes = await request(app)
      .post(`/api/bills/${creditBillId}/payments`)
      .set('Authorization', `Bearer ${secondUserToken}`)
      .send({
        amount: 50
      });
    expect(payRes.statusCode).toBe(404); // Should not find the bill
  });

  it('should support customer-level bulk payment recording, settling oldest bills first', async () => {
    // 1. Create two credit bills for the same customer phone number
    const phone = '9876543210';
    
    const bill1 = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Bulk Customer',
        customerPhone: phone,
        paymentType: 'Credit',
        items: [{ productName: 'Item A', price: 100, quantity: 2, gst: 0 }] // Total = 200
      });

    const bill2 = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Bulk Customer',
        customerPhone: phone,
        paymentType: 'Credit',
        items: [{ productName: 'Item B', price: 300, quantity: 1, gst: 0 }] // Total = 300
      });

    expect(bill1.statusCode).toBe(201);
    expect(bill2.statusCode).toBe(201);

    // 2. Settle ₹350 at customer level (should fully pay bill1 [₹200] and partially pay bill2 [₹150 of ₹300, leaving ₹150])
    const payRes = await request(app)
      .post(`/api/bills/customer/${phone}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 350,
        note: 'Customer bulk pay'
      });

    expect(payRes.statusCode).toBe(200);
    expect(payRes.body.success).toBe(true);
    expect(payRes.body.settledInvoicesCount).toBe(2);

    // 3. Fetch both bills to verify statuses
    const b1 = await Bill.findById(bill1.body._id);
    const b2 = await Bill.findById(bill2.body._id);

    expect(b1.status).toBe('paid');
    expect(b1.remainingAmount).toBe(0);
    expect(b2.status).toBe('partial');
    expect(b2.remainingAmount).toBe(150);
  });

  it('should delete a bill and restore product stocks', async () => {
    const Product = mongoose.model('Product');
    // 1. Create a product with specific stock
    const prodRes = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Deductible Product',
        price: 50,
        gst: 0,
        stock: 10
      });
    expect(prodRes.statusCode).toBe(201);
    
    // 2. Create a bill with that product
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Stock Tester',
        customerPhone: '9876543210',
        paymentType: 'Paid',
        items: [{ productName: 'Deductible Product', price: 50, quantity: 3, gst: 0 }]
      });
    expect(billRes.statusCode).toBe(201);
    
    // 3. Verify stock was deducted (10 - 3 = 7)
    let p = await Product.findById(prodRes.body._id);
    expect(p.stock).toBe(7);
    
    // 4. Delete the bill
    const deleteRes = await request(app)
      .delete(`/api/bills/${billRes.body._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(deleteRes.statusCode).toBe(200);
    
    // 5. Verify the bill is deleted
    const deletedBill = await Bill.findById(billRes.body._id);
    expect(deletedBill).toBeNull();
    
    // 6. Verify stock was restored back to 10
    p = await Product.findById(prodRes.body._id);
    expect(p.stock).toBe(10);
  });

  it('should allow setting new reminder date on partial payments', async () => {
    // 1. Create a credit bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Reminder Tester',
        customerPhone: '9876543210',
        paymentType: 'Credit',
        items: [{ productName: 'Credit Item', price: 200, quantity: 1, gst: 0 }]
      });
    expect(billRes.statusCode).toBe(201);
    const billId = billRes.body._id;

    // 2. Record a partial payment with a new reminder date
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const dateStr = nextWeek.toISOString().split('T')[0];

    const payRes = await request(app)
      .post(`/api/bills/${billId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 50,
        note: 'Partial pay with date update',
        dueDate: dateStr
      });
    expect(payRes.statusCode).toBe(200);

    // 3. Verify the bill's dueDate has been updated
    const updatedBill = await Bill.findById(billId);
    expect(updatedBill.status).toBe('partial');
    expect(updatedBill.remainingAmount).toBe(150);
    expect(new Date(updatedBill.dueDate).toISOString().split('T')[0]).toBe(dateStr);
  });

  it('should allow setting new reminder date on customer bulk payments', async () => {
    const phone = '9998887776';
    // 1. Create a credit bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Customer Bulk Reminder Tester',
        customerPhone: phone,
        paymentType: 'Credit',
        items: [{ productName: 'Credit Item', price: 300, quantity: 1, gst: 0 }]
      });
    expect(billRes.statusCode).toBe(201);

    // 2. Record bulk payment with a new reminder date
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    const dateStr = nextWeek.toISOString().split('T')[0];

    const bulkPayRes = await request(app)
      .post(`/api/bills/customer/${phone}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        amount: 100,
        note: 'Bulk partial pay',
        dueDate: dateStr
      });
    expect(bulkPayRes.statusCode).toBe(200);

    // 3. Verify the bill has the new reminder date
    const updatedBill = await Bill.findById(billRes.body._id);
    expect(updatedBill.status).toBe('partial');
    expect(updatedBill.remainingAmount).toBe(200);
    expect(new Date(updatedBill.dueDate).toISOString().split('T')[0]).toBe(dateStr);
  });

  it('should return Click-to-Chat fallback WhatsApp URL if not connected', async () => {
    // 1. Create a credit bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'WhatsApp Tester',
        customerPhone: '9998886665',
        paymentType: 'Credit',
        items: [{ productName: 'Credit Item', price: 100, quantity: 1, gst: 0 }]
      });
    expect(billRes.statusCode).toBe(201);
    const billId = billRes.body._id;
    const invoiceNo = billId.toString().slice(-6).toUpperCase();

    // 2. Request WhatsApp reminder for single bill
    const reminderRes = await request(app)
      .post(`/api/bills/${billId}/whatsapp-reminder`)
      .set('Authorization', `Bearer ${token}`);

    expect(reminderRes.statusCode).toBe(200);
    expect(reminderRes.body.notConnected).toBe(true);
    expect(reminderRes.body.whatsappUrl).toContain('https://api.whatsapp.com/send');
    expect(reminderRes.body.whatsappUrl).toContain('9998886665');
    // Verify custom template parsing
    const decodedSingleUrl = decodeURIComponent(reminderRes.body.whatsappUrl);
    expect(decodedSingleUrl).toContain('Custom reminder for WhatsApp Tester outstanding: 100.00 invoice: ' + invoiceNo);

    // 3. Request WhatsApp reminder for customer level
    const custReminderRes = await request(app)
      .post(`/api/bills/customer/9998886665/whatsapp-reminder`)
      .set('Authorization', `Bearer ${token}`);

    expect(custReminderRes.statusCode).toBe(200);
    expect(custReminderRes.body.notConnected).toBe(true);
    expect(custReminderRes.body.whatsappUrl).toContain('https://api.whatsapp.com/send');
    expect(custReminderRes.body.whatsappUrl).toContain('9998886665');
    // Verify custom template parsing for bulk customer reminder
    const decodedCustUrl = decodeURIComponent(custReminderRes.body.whatsappUrl);
    expect(decodedCustUrl).toContain('Custom reminder for WhatsApp Tester outstanding: 100.00 invoice: Multiple');
  });

  it('should allow directly updating the reminder date of a specific bill', async () => {
    // 1. Create a credit bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Direct Edit Tester',
        customerPhone: '9876543210',
        paymentType: 'Credit',
        items: [{ productName: 'Credit Item', price: 100, quantity: 1, gst: 0 }]
      });
    expect(billRes.statusCode).toBe(201);
    const billId = billRes.body._id;

    // 2. Update reminder date directly
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const dateStr = futureDate.toISOString().split('T')[0];

    const putRes = await request(app)
      .put(`/api/bills/${billId}/reminder-date`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dueDate: dateStr
      });
    expect(putRes.statusCode).toBe(200);

    // 3. Verify it changed in database
    const updatedBill = await Bill.findById(billId);
    expect(new Date(updatedBill.dueDate).toISOString().split('T')[0]).toBe(dateStr);
  });

  it('should allow directly updating the reminder date for all customer pending bills', async () => {
    const phone = '9991112223';
    // 1. Create a credit bill
    const billRes = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Customer Bulk Edit Tester',
        customerPhone: phone,
        paymentType: 'Credit',
        items: [{ productName: 'Credit Item', price: 100, quantity: 1, gst: 0 }]
      });
    expect(billRes.statusCode).toBe(201);

    // 2. Update customer bills reminder date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20);
    const dateStr = futureDate.toISOString().split('T')[0];

    const putRes = await request(app)
      .put(`/api/bills/customer/${phone}/reminder-date`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        dueDate: dateStr
      });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.body.success).toBe(true);

    // 3. Verify it changed in database
    const updatedBill = await Bill.findById(billRes.body._id);
    expect(new Date(updatedBill.dueDate).toISOString().split('T')[0]).toBe(dateStr);
  });
});


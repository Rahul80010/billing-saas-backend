const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const Campaign = require('../models/Campaign');
const Customer = require('../models/Customer');
const WhatsAppConnection = require('../models/WhatsAppConnection');

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
      name: 'User A',
      email: 'usera@example.com',
      password: 'password123'
    });

  const User = mongoose.model('User');
  const user1 = await User.findOne({ email: 'usera@example.com' });
  const verifyRes1 = await request(app)
    .post('/api/auth/verify-otp')
    .send({
      email: 'usera@example.com',
      otp: user1.otp
    });
  token = verifyRes1.body.token;

  // Register a second test user to verify user isolation
  await request(app)
    .post('/api/auth/register')
    .send({
      name: 'User B',
      email: 'userb@example.com',
      password: 'password123'
    });

  const user2 = await User.findOne({ email: 'userb@example.com' });
  const verifyRes2 = await request(app)
    .post('/api/auth/verify-otp')
    .send({
      email: 'userb@example.com',
      otp: user2.otp
    });
  secondUserToken = verifyRes2.body.token;

  // Pre-populate customers for User A
  await Customer.create({
    userId: user1._id,
    name: 'Customer A1',
    phone: '9990001111'
  });
  await Customer.create({
    userId: user1._id,
    name: 'Customer A2',
    phone: '9990002222'
  });

  // Pre-populate customers for User B
  await Customer.create({
    userId: user2._id,
    name: 'Customer B1',
    phone: '9990003333'
  });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('WhatsApp CRM API', () => {
  it('should fetch empty stats initially for authenticated User A', async () => {
    const res = await request(app)
      .get('/api/crm/stats')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.isConnected).toBe(false);
    expect(res.body.totalCustomers).toBe(2);
    expect(res.body.campaignsCount).toBe(0);
    expect(res.body.totalMessagesSent).toBe(0);
  });

  it('should return customers in segment filter for User A', async () => {
    const res = await request(app)
      .get('/api/crm/segments?segment=all')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].name).toBe('Customer A1');
  });

  it('should fail to create campaign if no WhatsApp connection exists', async () => {
    const res = await request(app)
      .post('/api/crm/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Failure Campaign',
        message: 'Hello Customer',
        recipients: [{ name: 'Customer A1', phone: '9990001111' }]
      });
    
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('No active WhatsApp connection');
  });

  it('should create a campaign successfully with simulated Sandbox Mode', async () => {
    // 1. Setup mock WhatsApp connection for User A
    const User = mongoose.model('User');
    const user1 = await User.findOne({ email: 'usera@example.com' });
    const { encrypt } = require('../services/encryptionService');
    const encryptedToken = encrypt('fake_token');
    
    await WhatsAppConnection.create({
      userId: user1._id,
      wabaId: '12345',
      phoneNumberId: '67890',
      accessToken: encryptedToken,
      phoneNumber: '919999999999',
      businessName: 'User A Retail Store'
    });

    // 2. Dispatch campaign (will execute in Sandbox Mode logs because token is decryptable but dummy)
    const res = await request(app)
      .post('/api/crm/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Simulated Launch',
        message: 'Exciting news! 20% off all billing SaaS services.',
        recipients: [
          { name: 'Customer A1', phone: '9990001111' },
          { name: 'Customer A2', phone: '9990002222' }
        ]
      });

    // 3. Confirm campaign creation
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Simulated Launch');
    expect(res.body.recipientsCount).toBe(2);
    expect(res.body.recipients.length).toBe(2);
    expect(res.body.recipients[0].status).toBe('sent'); // sandbox handles it as sent

    // 4. Verify CRM stats reflect the campaign count
    const statsRes = await request(app)
      .get('/api/crm/stats')
      .set('Authorization', `Bearer ${token}`);
    
    expect(statsRes.statusCode).toBe(200);
    expect(statsRes.body.isConnected).toBe(true);
    expect(statsRes.body.campaignsCount).toBe(1);
    expect(statsRes.body.totalMessagesSent).toBe(2);
  });

  it('should verify User Isolation: User B cannot see User A campaigns', async () => {
    // 1. Fetch campaigns as User A (should be 1)
    const resA = await request(app)
      .get('/api/crm/campaigns')
      .set('Authorization', `Bearer ${token}`);
    expect(resA.statusCode).toBe(200);
    expect(resA.body.length).toBe(1);
    expect(resA.body[0].name).toBe('Simulated Launch');

    // 2. Fetch campaigns as User B (should be 0)
    const resB = await request(app)
      .get('/api/crm/campaigns')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(resB.statusCode).toBe(200);
    expect(resB.body.length).toBe(0);

    // 3. Fetch CRM stats as User B (should show 0 campaigns, 1 customer)
    const statsB = await request(app)
      .get('/api/crm/stats')
      .set('Authorization', `Bearer ${secondUserToken}`);
    expect(statsB.statusCode).toBe(200);
    expect(statsB.body.totalCustomers).toBe(1);
    expect(statsB.body.campaignsCount).toBe(0);
    expect(statsB.body.totalMessagesSent).toBe(0);
  });

  it('should create a campaign successfully with an image attachment in Sandbox Mode', async () => {
    const res = await request(app)
      .post('/api/crm/campaigns')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Promo with Image',
        message: 'Get this awesome offer!',
        recipients: [{ name: 'Customer A1', phone: '9990001111' }],
        image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
      });

    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Promo with Image');
    expect(res.body.image).toContain('data:image/jpeg;base64');
    expect(res.body.recipientsCount).toBe(1);
  });
});

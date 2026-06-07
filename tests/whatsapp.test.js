const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const axios = require('axios');
const WhatsAppConnection = require('../models/WhatsAppConnection');

jest.mock('axios');
jest.setTimeout(30000);

let mongoServer;
let token;
let userId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Set up mock env variables
  process.env.FACEBOOK_APP_ID = 'mock_app_id';
  process.env.FACEBOOK_APP_SECRET = 'mock_app_secret';
  process.env.WEBHOOK_VERIFY_TOKEN = 'mock_verify_token';
  process.env.ENCRYPTION_KEY = 'mock_encryption_key_for_testing_32';

  // Register and login test user
  await request(app)
    .post('/api/auth/register')
    .send({
      name: 'WhatsApp User',
      email: 'whatsapp@example.com',
      password: 'password123'
    });

  const User = mongoose.model('User');
  const user = await User.findOne({ email: 'whatsapp@example.com' });
  userId = user._id;

  const verifyRes = await request(app)
    .post('/api/auth/verify-otp')
    .send({
      email: 'whatsapp@example.com',
      otp: user.otp
    });
  token = verifyRes.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('WhatsApp API & Embedded Signup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should fail to connect if accessToken is missing', async () => {
    const res = await request(app)
      .post('/api/whatsapp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('Access Token is required');
  });

  it('should successfully complete Embedded Signup onboarding flow and save connection', async () => {
    // Mock Meta Graph API exchange token endpoint
    axios.get.mockImplementation((url, config) => {
      if (url.includes('/oauth/access_token')) {
        return Promise.resolve({
          data: { access_token: 'long_lived_token_xyz' }
        });
      }
      if (url.includes('/me/whatsapp_business_accounts')) {
        return Promise.resolve({
          data: {
            data: [
              { id: 'waba_id_123', name: 'Mock WABA Account' }
            ]
          }
        });
      }
      if (url.includes('/phone_numbers')) {
        return Promise.resolve({
          data: {
            data: [
              { id: 'phone_id_456', display_phone_number: '+1 555-0100' }
            ]
          }
        });
      }
      if (url.includes('/waba_id_123')) {
        return Promise.resolve({
          data: {
            owner_business_info: { id: 'portfolio_id_789' }
          }
        });
      }
      return Promise.reject(new Error(`Unhandled GET request to ${url}`));
    });

    const res = await request(app)
      .post('/api/whatsapp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ accessToken: 'short_lived_token' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.connection.wabaId).toBe('waba_id_123');
    expect(res.body.connection.phoneNumberId).toBe('phone_id_456');
    expect(res.body.connection.phoneNumber).toBe('+1 555-0100');
    expect(res.body.connection.businessName).toBe('Mock WABA Account');
    expect(res.body.connection.businessId).toBe('portfolio_id_789');

    // Verify record exists in DB
    const conn = await WhatsAppConnection.findOne({ userId });
    expect(conn).toBeDefined();
    expect(conn.wabaId).toBe('waba_id_123');
    expect(conn.phoneNumberId).toBe('phone_id_456');
  });

  it('should fetch connection status', async () => {
    const res = await request(app)
      .get('/api/whatsapp/status')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.connection.wabaId).toBe('waba_id_123');
  });

  it('should trigger test connection diagnostic message successfully', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        messages: [{ id: 'mock_message_id_999' }]
      }
    });

    const res = await request(app)
      .post('/api/whatsapp/test-embedded')
      .set('Authorization', `Bearer ${token}`)
      .send({ to: '919876543210' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('mock_message_id_999');

    // Verify payload dispatched matches Meta specifications
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/phone_id_456/messages'),
      expect.objectContaining({
        messaging_product: 'whatsapp',
        to: '919876543210',
        type: 'text',
        text: expect.objectContaining({
          body: expect.stringContaining('Your WhatsApp Embedded Signup connection is fully verified')
        })
      }),
      expect.any(Object)
    );
  });

  it('should fail test connection if destination phone number is missing', async () => {
    const res = await request(app)
      .post('/api/whatsapp/test-embedded')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('Please provide a target phone number');
  });

  it('should disconnect WhatsApp connection', async () => {
    const res = await request(app)
      .delete('/api/whatsapp/disconnect')
      .set('Authorization', `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify deleted in DB
    const conn = await WhatsAppConnection.findOne({ userId });
    expect(conn).toBeNull();

    // Verify status returns disconnected
    const statusRes = await request(app)
      .get('/api/whatsapp/status')
      .set('Authorization', `Bearer ${token}`);
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.body.connected).toBe(false);
  });
});

describe('WhatsApp Webhooks', () => {
  it('should successfully complete webhook GET validation handshake', async () => {
    const res = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'mock_verify_token',
        'hub.challenge': '12345challenge'
      });

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('12345challenge');
  });

  it('should reject webhook GET validation with token mismatch', async () => {
    const res = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong_token',
        'hub.challenge': '12345challenge'
      });

    expect(res.statusCode).toBe(403);
    expect(res.text).toBe('Forbidden: Token mismatch');
  });

  it('should process webhook POST message delivery status updates', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_id_123',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550100', phone_number_id: '456' },
            statuses: [{
              id: 'msg_id_abc123',
              status: 'delivered',
              recipient_id: '919876543210',
              timestamp: '1600000000'
            }]
          }
        }]
      }]
    };

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('EVENT_RECEIVED');
  });

  it('should process webhook POST incoming customer messages', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_id_123',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550100', phone_number_id: '456' },
            contacts: [{ profile: { name: 'Customer' }, wa_id: '919876543210' }],
            messages: [{
              from: '919876543210',
              id: 'msg_id_xyz789',
              timestamp: '1600000001',
              text: { body: 'Hello Merchant!' },
              type: 'text'
            }]
          }
        }]
      }]
    };

    const res = await request(app)
      .post('/api/webhooks/whatsapp')
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('EVENT_RECEIVED');
  });
});

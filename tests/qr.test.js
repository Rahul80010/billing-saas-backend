const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const { generateUpiUri, generateQrBuffer } = require('../services/qrService');
const Bill = require('../models/Bill');

jest.setTimeout(60000);

let mongoServer;
let token;
let userId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Register a test user
  await request(app)
    .post('/api/auth/register')
    .send({
      name: 'UPI Merchant',
      email: 'merchant@upi.com',
      password: 'password123'
    });

  const User = mongoose.model('User');
  const user = await User.findOne({ email: 'merchant@upi.com' });
  userId = user._id;

  const verifyRes = await request(app)
    .post('/api/auth/verify-otp')
    .send({
      email: 'merchant@upi.com',
      otp: user.otp
    });
  token = verifyRes.body.token;
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('UPI QR Code Service', () => {
  it('should generate a valid UPI Pay URI', () => {
    const uri = generateUpiUri('merchant@upi', 'My Business Name', 2500.5, 'Invoice-1234');
    expect(uri).toContain('upi://pay');
    expect(uri).toContain('pa=merchant@upi');
    expect(uri).toContain('pn=My%20Business%20Name');
    expect(uri).toContain('am=2500.50');
    expect(uri).toContain('mam=0.01');
    expect(uri).toContain('tn=Invoice-1234');
  });

  it('should generate a valid QR code buffer from UPI URI', async () => {
    const uri = generateUpiUri('merchant@upi', 'My Business Name', 2500.5, 'Invoice-1234');
    const qrBuffer = await generateQrBuffer(uri);
    expect(Buffer.isBuffer(qrBuffer)).toBe(true);
    // PNG signature check (starts with 0x89 0x50 0x4E 0x47)
    expect(qrBuffer[0]).toBe(0x89);
    expect(qrBuffer[1]).toBe(0x50);
    expect(qrBuffer[2]).toBe(0x4E);
    expect(qrBuffer[3]).toBe(0x47);
  });
});

describe('UPI Settings Profile API', () => {
  it('should update UPI settings on profile update', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        upiId: 'merchant@ybl',
        upiName: 'Mohuri Merchant',
        enableInvoiceQr: true,
        enableWhatsappQr: true
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.upiId).toBe('merchant@ybl');
    expect(res.body.upiName).toBe('Mohuri Merchant');
    expect(res.body.enableInvoiceQr).toBe(true);
    expect(res.body.enableWhatsappQr).toBe(true);
  });
});

describe('Invoice PDF QR Embedding API', () => {
  it('should generate a PDF and return a stream containing a QR code if enabled', async () => {
    // Enable QR settings first
    await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        upiId: 'merchant@ybl',
        enableInvoiceQr: true
      });

    // Create a mock bill
    const bill = await Bill.create({
      userId,
      customerName: 'Aman Kumar',
      customerPhone: '9988776655',
      items: [{ productName: 'Mouse', price: 500, quantity: 1, gst: 18 }],
      total: 590,
      paymentType: 'Paid',
      status: 'paid'
    });

    const res = await request(app)
      .get(`/api/bills/${bill._id}/pdf`);

    expect(res.statusCode).toBe(200);
    expect(res.header['content-type']).toBe('application/pdf');
    // PDF signature check (%PDF-...)
    expect(res.body.toString('utf8', 0, 4)).toBe('%PDF');
  });
});

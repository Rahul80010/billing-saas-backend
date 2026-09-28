const request = require('supertest');
const crypto = require('crypto');
const app = require('../server');
const { generateInvoiceSignature, verifyInvoiceSignature } = require('../utils/signedUrl');
const { authorize } = require('../middleware/authMiddleware');

describe('SEC-01: Invoice PDF HMAC Cryptographic Signature Verification', () => {
  const testBillId = '664a1b2c3d4e5f6a7b8c9d0e';
  const testSecret = 'mohuri_test_hmac_secret_key_123';

  it('should validate a genuine signature with future expiration', () => {
    const { sig, expires } = generateInvoiceSignature(testBillId, testSecret, 3600);
    const isValid = verifyInvoiceSignature(testBillId, expires, sig, testSecret);
    expect(isValid).toBe(true);
  });

  it('should reject an expired signature', () => {
    const { sig, expires } = generateInvoiceSignature(testBillId, testSecret, -60);
    const isValid = verifyInvoiceSignature(testBillId, expires, sig, testSecret);
    expect(isValid).toBe(false);
  });

  it('should reject a forged signature', () => {
    const { expires } = generateInvoiceSignature(testBillId, testSecret, 3600);
    const isValid = verifyInvoiceSignature(testBillId, expires, 'bad_forged_signature_hash', testSecret);
    expect(isValid).toBe(false);
  });

  it('should reject if billId is tampered with', () => {
    const { sig, expires } = generateInvoiceSignature(testBillId, testSecret, 3600);
    const differentBillId = '664a1b2c3d4e5f6a7b8c9d99';
    const isValid = verifyInvoiceSignature(differentBillId, expires, sig, testSecret);
    expect(isValid).toBe(false);
  });

  it('should reject if expiration timestamp is tampered with', () => {
    const { sig, expires } = generateInvoiceSignature(testBillId, testSecret, 3600);
    const tamperedExpires = expires + 1000;
    const isValid = verifyInvoiceSignature(testBillId, tamperedExpires, sig, testSecret);
    expect(isValid).toBe(false);
  });
});

const { validateSafeUrl, isPrivateOrBlockedIp } = require('../controllers/uploadController');

describe('SEC-09: SSRF IP & URL Validation', () => {
  it('should identify loopback and private IP addresses as blocked', () => {
    expect(isPrivateOrBlockedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIp('127.0.0.2')).toBe(true);
    expect(isPrivateOrBlockedIp('169.254.169.254')).toBe(true); // AWS/GCP metadata
    expect(isPrivateOrBlockedIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrBlockedIp('192.168.1.1')).toBe(true);
    expect(isPrivateOrBlockedIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrBlockedIp('::1')).toBe(true);
    expect(isPrivateOrBlockedIp('fc00::1')).toBe(true);
    expect(isPrivateOrBlockedIp('fe80::1')).toBe(true);
  });

  it('should identify public IPs as permitted', () => {
    expect(isPrivateOrBlockedIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrBlockedIp('1.1.1.1')).toBe(false);
    expect(isPrivateOrBlockedIp('142.250.190.46')).toBe(false);
  });

  it('should reject non-http schemes via validateSafeUrl', async () => {
    await expect(validateSafeUrl('ftp://example.com/image.png')).rejects.toThrow('Disallowed protocol');
    await expect(validateSafeUrl('file:///etc/passwd')).rejects.toThrow('Disallowed protocol');
    await expect(validateSafeUrl('gopher://example.com/')).rejects.toThrow('Disallowed protocol');
  });

  it('should reject localhost and internal hostnames via validateSafeUrl', async () => {
    await expect(validateSafeUrl('http://localhost:5000/')).rejects.toThrow('Disallowed host');
    await expect(validateSafeUrl('http://server.local/api')).rejects.toThrow('Disallowed host');
    await expect(validateSafeUrl('http://cluster.internal/')).rejects.toThrow('Disallowed host');
  });

  it('should reject literal private IP URLs via validateSafeUrl', async () => {
    await expect(validateSafeUrl('http://127.0.0.1:8080/')).rejects.toThrow('Disallowed destination IP');
    await expect(validateSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow('Disallowed destination IP');
    await expect(validateSafeUrl('http://192.168.0.1/')).rejects.toThrow('Disallowed destination IP');
  });

  it('should reject loopback IP (127.0.0.1) on API upload endpoint', async () => {
    const res = await request(app)
      .post('/api/upload/image-url')
      .send({ imageUrl: 'http://127.0.0.1:8080/admin' });
    expect([400, 401]).toContain(res.status);
  });
});

describe('SEC-10: Server-Side Role-Based Access Control (RBAC)', () => {
  const mockRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it('should allow owner access to restricted owner routes', () => {
    const req = { user: { role: 'owner', _id: 'owner1' } };
    const res = mockRes();
    const next = jest.fn();

    authorize('owner', 'manager')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should allow manager access to restricted routes', () => {
    const req = { user: { role: 'manager', _id: 'mgr1' } };
    const res = mockRes();
    const next = jest.fn();

    authorize('owner', 'manager')(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should block cashier from accessing owner/manager restricted routes', () => {
    const req = { user: { role: 'cashier', _id: 'cashier1' } };
    const res = mockRes();
    const next = jest.fn();

    authorize('owner', 'manager')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should block waiter from accessing owner/manager restricted routes', () => {
    const req = { user: { role: 'waiter', _id: 'waiter1' } };
    const res = mockRes();
    const next = jest.fn();

    authorize('owner', 'manager')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should block kitchen staff from accessing owner/manager restricted routes', () => {
    const req = { user: { role: 'kitchen', _id: 'kitchen1' } };
    const res = mockRes();
    const next = jest.fn();

    authorize('owner', 'manager')(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('SEC-13: Security Headers Verification', () => {
  it('should include nosniff, DENY, and remove X-Powered-By on HTTP responses', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('SEC-08: Admin Debug Routes Protection', () => {
  it('should block unauthenticated access to /api/auth/debug-smtp', async () => {
    const res = await request(app).get('/api/auth/debug-smtp');
    expect(res.status).toBe(401);
  });

  it('should block unauthenticated access to /api/auth/test-email', async () => {
    const res = await request(app).post('/api/auth/test-email').send({ email: 'test@example.com' });
    expect(res.status).toBe(401);
  });
});

describe('SEC-01: Public Bill PDF Without Auth or Signature', () => {
  it('should deny unauthenticated requests to /api/bills/:id/pdf', async () => {
    const res = await request(app).get('/api/bills/664a1b2c3d4e5f6a7b8c9d0e/pdf');
    expect(res.status).toBe(401);
  });
});

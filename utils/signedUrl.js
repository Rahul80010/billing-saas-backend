const crypto = require('crypto');

/**
 * Generate a signed invoice download query string with an expiration timestamp.
 *
 * @param {string} billId - The MongoDB ObjectId or string ID of the bill.
 * @param {string} secret - The secret key (e.g. process.env.JWT_SECRET).
 * @param {number} expiresInSeconds - Validity duration in seconds (default 7 days).
 * @returns {object} - { expires, sig, query }
 */
function generateInvoiceSignature(billId, secret = process.env.JWT_SECRET || 'mohuri_jwt_fallback_secret', expiresInSeconds = 7 * 24 * 3600) {
  if (!billId) {
    throw new Error('billId is required for generating signature');
  }
  const effectiveSecret = secret || process.env.JWT_SECRET || 'mohuri_jwt_fallback_secret';
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${billId}:${expires}`;
  const sig = crypto.createHmac('sha256', effectiveSecret).update(payload).digest('hex');
  return { expires, sig, query: `?expires=${expires}&sig=${sig}` };
}

/**
 * Verify whether an invoice signature is cryptographically valid and not expired.
 *
 * @param {string} billId - The bill ID being accessed.
 * @param {number|string} expires - Expiration unix timestamp in seconds.
 * @param {string} sig - The hex HMAC signature to verify.
 * @param {string} secret - The secret key used for signing (defaults to JWT_SECRET).
 * @returns {boolean} - True if signature is valid and current, false otherwise.
 */
function verifyInvoiceSignature(billId, expires, sig, secret = process.env.JWT_SECRET || 'mohuri_jwt_fallback_secret') {
  const effectiveSecret = secret || process.env.JWT_SECRET || 'mohuri_jwt_fallback_secret';
  if (!billId || !expires || !sig || !effectiveSecret) {
    return false;
  }

  const expNum = Number(expires);
  if (isNaN(expNum) || expNum <= 0) {
    return false;
  }

  // Check expiration
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (currentTimestamp > expNum) {
    return false; // Expired
  }

  const payload = `${billId}:${expNum}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  // Timing safe equality comparison to prevent timing side-channel attacks
  try {
    const expectedBuffer = Buffer.from(expectedSig, 'hex');
    const providedBuffer = Buffer.from(sig, 'hex');
    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch (err) {
    return false;
  }
}

module.exports = {
  generateInvoiceSignature,
  verifyInvoiceSignature,
};

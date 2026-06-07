const crypto = require('crypto');

// Hashed to guarantee exactly 32 bytes for aes-256-cbc key length
const SECRET = process.env.ENCRYPTION_KEY || 'mohuri-default-key-fallback-32b-length';

/**
 * Encrypt clear text
 * @param {string} text 
 * @returns {string} ivHex:encryptedHex
 */
const encrypt = (text) => {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const key = crypto.createHash('sha256').update(SECRET).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
};

/**
 * Decrypt cipher text
 * @param {string} encryptedText 
 * @returns {string} clearText
 */
const decrypt = (encryptedText) => {
  if (!encryptedText) return '';
  try {
    const [ivHex, encryptedHex] = encryptedText.split(':');
    if (!ivHex || !encryptedHex) return '';
    const iv = Buffer.from(ivHex, 'hex');
    const key = crypto.createHash('sha256').update(SECRET).digest();
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('[Encryption] Decryption failed:', error.message);
    return '';
  }
};

module.exports = {
  encrypt,
  decrypt,
};

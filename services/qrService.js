const QRCode = require('qrcode');

/**
 * Generate a standard-compliant UPI Payment URI
 * @param {string} upiId - Payee VPA / UPI ID
 * @param {string} payeeName - Merchant / Business name
 * @param {number} amount - Payment amount
 * @param {string} note - Transaction reference or invoice number
 * @returns {string} UPI deep link URI
 */
const generateUpiUri = (upiId, payeeName, amount, note = '') => {
  if (!upiId) return '';
  
  // Clean special characters from names to comply with bank validation patterns
  const cleanName = payeeName.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const cleanNote = note.replace(/[^a-zA-Z0-9\s-]/g, '').trim();
  
  const formattedAmount = Number(amount).toFixed(2);
  
  let uri = `upi://pay?pa=${upiId}&pn=${encodeURIComponent(cleanName)}&am=${formattedAmount}&cu=INR`;
  if (cleanNote) {
    uri += `&tn=${encodeURIComponent(cleanNote)}`;
  }
  
  return uri;
};

/**
 * Generate a PNG QR Code image buffer for a given URI
 * @param {string} uri - Target URI data
 * @returns {Promise<Buffer>} PNG image buffer
 */
const generateQrBuffer = async (uri) => {
  if (!uri) throw new Error('Cannot generate QR code: Target URI is empty');
  
  return await QRCode.toBuffer(uri, {
    type: 'png',
    margin: 1,
    width: 250,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
};

module.exports = {
  generateUpiUri,
  generateQrBuffer
};

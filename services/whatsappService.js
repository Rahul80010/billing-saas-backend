const axios = require('axios');

/**
 * Clean phone number to conform with Meta API specs (digits only)
 * e.g., "+91 98765-43210" -> "919876543210"
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
};

/**
 * Sends a transactional WhatsApp document message to a customer with their invoice PDF
 * @param {string} phone - Customer's phone number
 * @param {string} customerName - Customer's name
 * @param {number} total - Bill total amount
 * @param {string} pdfLink - Public link to the dynamic invoice PDF
 * @param {string} businessName - Merchant's business name
 * @param {object} userConfig - Merchant's custom WhatsApp credentials
 */
const sendWhatsappBill = async (phone, customerName, total, pdfLink, businessName, userConfig = {}) => {
  // Use merchant's custom credentials if configured, otherwise fallback to system global envs
  const token = userConfig.whatsappToken || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = userConfig.whatsappPhoneNumberId || process.env.PHONE_NUMBER_ID;

  const cleanPhone = formatPhoneNumber(phone);
  if (!cleanPhone) {
    console.error('[WhatsApp] Failed: Target phone number is empty or invalid.');
    return false;
  }

  const billId = pdfLink ? pdfLink.split('/').slice(-2)[0] : 'RECEIPT';
  const shortBillId = billId.slice(-6).toUpperCase();
  const filename = `invoice_${shortBillId}.pdf`;
  const caption = `Hello ${customerName}, here is your invoice from ${businessName || 'MOHURI'}.\nTotal: ₹${Number(total).toFixed(2)}`;

  // Sandbox Mode: if no API credentials are configured, print to the server logs
  if (!token || !phoneNumberId) {
    console.log('\n==================================================');
    console.log(`[WHATSAPP SANDBOX MODE] Sending PDF to: ${cleanPhone}`);
    console.log(`Merchant Business Name: ${businessName || 'MOHURI'}`);
    console.log(`PDF Document Link: ${pdfLink || 'N/A'}`);
    console.log(`Caption: ${caption}`);
    console.log('==================================================\n');
    return true;
  }

  try {
    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'document',
      document: {
        link: pdfLink,
        caption: caption,
        filename: filename
      }
    };

    console.log(`[WhatsApp] Dispatching invoice document to: ${cleanPhone} (Using config: ${userConfig.whatsappToken ? 'Merchant Custom' : 'System Default'})`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status === 200 || response.status === 201) {
      console.log(`[WhatsApp] PDF invoice successfully sent to ${cleanPhone}. Message ID: ${response.data.messages?.[0]?.id || 'N/A'}`);
      return true;
    } else {
      console.error(`[WhatsApp] Meta API returned non-200 status code: ${response.status}`, response.data);
      return false;
    }
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error(`[WhatsApp] Failed to send invoice document to ${cleanPhone}:`, errorDetails);
    return false;
  }
};

module.exports = { sendWhatsappBill };

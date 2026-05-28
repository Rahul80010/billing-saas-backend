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
 * Sends a transactional WhatsApp message to a customer with their bill details
 * @param {string} phone - Customer's phone number
 * @param {string} customerName - Customer's name
 * @param {number} total - Bill total amount
 */
const sendWhatsappBill = async (phone, customerName, total) => {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  const cleanPhone = formatPhoneNumber(phone);
  if (!cleanPhone) {
    console.error('[WhatsApp] Failed: Target phone number is empty or invalid.');
    return false;
  }

  const messageBody = `Hello ${customerName},\n\nYour bill has been generated successfully.\n\nTotal Amount: ₹${Number(total).toFixed(2)}\n\nThank you 🙏`;

  // Sandbox Mode: if Meta API credentials are not configured, print to the server logs
  if (!token || !phoneNumberId) {
    console.log('\n==================================================');
    console.log(`[WHATSAPP SANDBOX MODE] Sending to: ${cleanPhone}`);
    console.log('Body:');
    console.log(messageBody);
    console.log('==================================================\n');
    return true;
  }

  try {
    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: messageBody
      }
    };

    console.log(`[WhatsApp] Dispatching bill notification to: ${cleanPhone}`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status === 200 || response.status === 201) {
      console.log(`[WhatsApp] Message successfully sent to ${cleanPhone}. Message ID: ${response.data.messages?.[0]?.id || 'N/A'}`);
      return true;
    } else {
      console.error(`[WhatsApp] Meta API returned non-200 status code: ${response.status}`, response.data);
      return false;
    }
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error(`[WhatsApp] Failed to send message to ${cleanPhone}:`, errorDetails);
    return false;
  }
};

module.exports = { sendWhatsappBill };

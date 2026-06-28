const axios = require('axios');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const { decrypt } = require('./encryptionService');
const { generateUpiUri, generateQrBuffer } = require('./qrService');

/**
 * Clean phone number to conform with Meta API specs (digits only)
 * e.g., "+91 98765-43210" -> "919876543210"
 */
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
};

/**
 * Sends a generic WhatsApp message (text or template)
 * @param {object} params
 * @param {string} params.phoneNumberId
 * @param {string} params.accessToken
 * @param {string} params.to
 * @param {string} [params.message]
 * @param {object} [params.template]
 */
const sendWhatsAppMessage = async ({ phoneNumberId, accessToken, to, message, template, mediaId, mediaType = 'image' }) => {
  const cleanPhone = formatPhoneNumber(to);
  if (!cleanPhone) {
    return { success: false, error: 'Target phone number is empty or invalid.' };
  }

  // Sandbox Mode: if no credentials are configured or using dummy tokens, print to the server logs
  if (!accessToken || !phoneNumberId || accessToken === 'mock_token' || accessToken.includes('fake')) {
    console.log('\n==================================================');
    console.log(`[WHATSAPP SANDBOX MODE] Sending Message to: ${cleanPhone}`);
    if (mediaId) {
      console.log(`Media Type: ${mediaType}`);
      console.log(`Media ID: ${mediaId}`);
      if (message) {
        console.log(`Caption: ${message}`);
      }
    } else {
      console.log(`Message Content: ${message || JSON.stringify(template)}`);
    }
    console.log('==================================================\n');
    return { success: true, sandbox: true, messageId: 'sandbox_msg_id' };
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    
    let payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
    };

    if (template) {
      payload.type = 'template';
      payload.template = template;
    } else if (mediaId) {
      payload.type = mediaType;
      payload[mediaType] = {
        id: mediaId,
        ...(message ? { caption: message } : {})
      };
    } else if (message) {
      payload.type = 'text';
      payload.text = { body: message };
    } else {
      return { success: false, error: 'Either message, template, or mediaId parameters must be provided' };
    }

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 seconds timeout
    });

    if (response.status === 200 || response.status === 201) {
      return { success: true, messageId: response.data.messages?.[0]?.id || 'N/A' };
    } else {
      return { success: false, error: `Meta API returned ${response.status}: ${JSON.stringify(response.data)}` };
    }
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error(`[WhatsApp] API Dispatch failed for ${cleanPhone}:`, errorDetails);
    return { success: false, error: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails };
  }
};

/**
 * Uploads media (images) to Meta WhatsApp media API.
 * @param {object} params
 * @param {string} params.phoneNumberId
 * @param {string} params.accessToken
 * @param {Buffer} params.buffer
 * @param {string} params.mimeType
 */
const uploadWhatsAppMedia = async ({ phoneNumberId, accessToken, buffer, mimeType }) => {
  if (!accessToken || !phoneNumberId || accessToken === 'mock_token' || accessToken.includes('fake')) {
    return { success: true, sandbox: true, mediaId: 'sandbox_media_id' };
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/media`;
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    const ext = mimeType.split('/')[1] || 'jpg';
    formData.append('file', blob, `campaign_image.${ext}`);
    formData.append('messaging_product', 'whatsapp');

    const response = await axios.post(url, formData, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      timeout: 20000 // 20 seconds timeout for image uploads
    });

    if (response.status === 200 || response.status === 201) {
      return { success: true, mediaId: response.data.id };
    } else {
      return { success: false, error: `Meta Media API returned ${response.status}: ${JSON.stringify(response.data)}` };
    }
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('[WhatsApp] Media upload failed:', errorDetails);
    return { success: false, error: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails };
  }
};

/**
 * Sends a transactional WhatsApp document message to a customer with their invoice PDF.
 * Backwards compatible with legacy manual credentials, but hooks into active WABA connections.
 */
const sendWhatsappBill = async (phone, customerName, total, pdfLink, businessName, userConfig = {}) => {
  let token = userConfig.whatsappToken;
  let phoneNumberId = userConfig.whatsappPhoneNumberId;
  const cleanPhone = formatPhoneNumber(phone);

  // If no manual config is passed, try to fetch the active WhatsApp Connection from db
  if (!token || !phoneNumberId) {
    try {
      // Find connection via userConfig.userId or fallback to querying
      const connection = await WhatsAppConnection.findOne(); // Fallback for simple tests
      if (connection) {
        token = decrypt(connection.accessToken);
        phoneNumberId = connection.phoneNumberId;
        businessName = connection.businessName || businessName;
      }
    } catch (dbErr) {
      console.error('[WhatsApp] Error fetching active connection in sendWhatsappBill:', dbErr.message);
    }
  }

  // Final fallback to system environment variables
  token = token || process.env.WHATSAPP_TOKEN;
  phoneNumberId = phoneNumberId || process.env.PHONE_NUMBER_ID;

  const template = userConfig.whatsappBillTemplate || 'Hello {customerName}, here is your invoice from {businessName}.\nTotal: ₹{total}';
  const caption = template
    .replace(/{customerName}/g, customerName)
    .replace(/{businessName}/g, businessName || 'MOHURI')
    .replace(/{total}/g, Number(total).toFixed(2));

  // Sandbox Mode: if no credentials are configured, print to the server logs
  if (!token || !phoneNumberId) {
    console.log('\n==================================================');
    console.log(`[WHATSAPP SANDBOX MODE] Sending PDF to: ${cleanPhone}`);
    console.log(`Merchant Business Name: ${businessName || 'MOHURI'}`);
    console.log(`PDF Document Link: ${pdfLink || 'N/A'}`);
    console.log(`Caption: ${caption}`);
    
    if (userConfig.enableWhatsappQr && userConfig.upiId) {
      console.log('--------------------------------------------------');
      console.log(`[WHATSAPP SANDBOX MODE] Sending UPI QR Code Image to: ${cleanPhone}`);
      const qrCaption = `Scan this QR Code to settle the bill of ₹${Number(total).toFixed(2)} via UPI.`;
      console.log(`Caption: ${qrCaption}`);
      console.log(`UPI ID: ${userConfig.upiId}`);
      console.log(`Payee Name: ${userConfig.upiName || businessName || 'MOHURI'}`);
    }
    console.log('==================================================\n');
    return { success: true, sandbox: true, caption };
  }

  try {
    const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
    const billId = pdfLink ? pdfLink.split('/').slice(-2)[0] : 'RECEIPT';
    const shortBillId = billId.slice(-6).toUpperCase();
    const filename = `invoice_${shortBillId}.pdf`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone,
      type: 'document',
      document: {
        link: pdfLink,
        filename: filename
      }
    };

    console.log(`[WhatsApp] Dispatching invoice document to: ${cleanPhone}`);
    
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.status === 200 || response.status === 201) {
      // Send QR Code if enabled
      if (userConfig.enableWhatsappQr && userConfig.upiId) {
        try {
          const upiUri = generateUpiUri(
            userConfig.upiId,
            userConfig.upiName || businessName || 'MOHURI',
            total,
            `Invoice-${shortBillId}`
          );
          const qrBuffer = await generateQrBuffer(upiUri);
          
          const uploadRes = await uploadWhatsAppMedia({
            phoneNumberId,
            accessToken: token,
            buffer: qrBuffer,
            mimeType: 'image/png'
          });
          
          if (uploadRes.success) {
            const qrCaption = `Scan this QR Code to settle the bill of ₹${Number(total).toFixed(2)} via UPI.`;
            await sendWhatsAppMessage({
              phoneNumberId,
              accessToken: token,
              to: phone,
              mediaId: uploadRes.mediaId,
              mediaType: 'image',
              message: qrCaption
            });
          } else {
            console.error('[WhatsApp Bill QR] Media upload failed:', uploadRes.error);
          }
        } catch (qrErr) {
          console.error('[WhatsApp Bill QR] Error generating or sending QR:', qrErr.message);
        }
      }

      return { success: true, messageId: response.data.messages?.[0]?.id || 'N/A' };
    } else {
      return { success: false, error: `Meta API returned ${response.status}: ${JSON.stringify(response.data)}` };
    }
  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    return { success: false, error: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails };
  }
};

/**
 * Sample Function: Send Invoice Message (using template)
 */
const sendInvoiceMessage = async (userId, { to, customerName, total, pdfLink, businessName }) => {
  try {
    const connection = await WhatsAppConnection.findOne({ userId });
    if (!connection) return { success: false, error: 'No active WhatsApp connection found' };

    const token = decrypt(connection.accessToken);
    const template = {
      name: 'invoice_confirmation',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: customerName },
            { type: 'text', text: `₹${Number(total).toFixed(2)}` },
            { type: 'text', text: businessName || connection.businessName }
          ]
        }
      ]
    };

    return await sendWhatsAppMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: token,
      to,
      template
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Sample Function: Send Payment Reminder (using template or text fallback)
 */
const sendPaymentReminder = async (userId, { to, customerName, amountDue, dueDate, businessName }) => {
  try {
    const connection = await WhatsAppConnection.findOne({ userId });
    if (!connection) return { success: false, error: 'No active WhatsApp connection found' };

    const token = decrypt(connection.accessToken);
    const message = `Hello ${customerName},\n\nThis is a friendly reminder that a payment of ₹${Number(amountDue).toFixed(2)} is outstanding for ${businessName || connection.businessName}. The due date is ${new Date(dueDate).toLocaleDateString()}.\n\nPlease clear it at your earliest convenience. Thank you!`;

    // Try to send text message directly (sandbox/session supports this)
    return await sendWhatsAppMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: token,
      to,
      message
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Sample Function: Send EMI Reminder
 */
const sendEMIReminder = async (userId, { to, customerName, emiAmount, dueDate, emiIndex, businessName }) => {
  try {
    const connection = await WhatsAppConnection.findOne({ userId });
    if (!connection) return { success: false, error: 'No active WhatsApp connection found' };

    const token = decrypt(connection.accessToken);
    const message = `Hello ${customerName},\n\nYour EMI installment #${emiIndex} of ₹${Number(emiAmount).toFixed(2)} for ${businessName || connection.businessName} is due on ${new Date(dueDate).toLocaleDateString()}.\n\nPlease ensure your linked account has sufficient balance. Thank you!`;

    return await sendWhatsAppMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: token,
      to,
      message
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
};

/**
 * Sample Function: Send Order Confirmation
 */
const sendOrderConfirmation = async (userId, { to, customerName, orderId, totalAmount, businessName }) => {
  try {
    const connection = await WhatsAppConnection.findOne({ userId });
    if (!connection) return { success: false, error: 'No active WhatsApp connection found' };

    const token = decrypt(connection.accessToken);
    const message = `Hello ${customerName},\n\nThank you for your order #${orderId.slice(-6).toUpperCase()} at ${businessName || connection.businessName}! We have received your payment of ₹${Number(totalAmount).toFixed(2)} and are preparing your receipt.`;

    return await sendWhatsAppMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: token,
      to,
      message
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
};

module.exports = {
  formatPhoneNumber,
  sendWhatsAppMessage,
  uploadWhatsAppMedia,
  sendWhatsappBill,
  sendInvoiceMessage,
  sendPaymentReminder,
  sendEMIReminder,
  sendOrderConfirmation,
};

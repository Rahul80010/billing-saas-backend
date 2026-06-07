const axios = require('axios');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const User = require('../models/User');
const { encrypt, decrypt } = require('../services/encryptionService');
const { sendWhatsAppMessage } = require('../services/whatsappService');

/**
 * @desc    Establish WhatsApp connection (Embedded Signup callback helper)
 * @route   POST /api/whatsapp/connect
 * @access  Private
 */
const connectWhatsApp = async (req, res) => {
  const { accessToken } = req.body;

  if (!accessToken) {
    return res.status(400).json({ message: 'Access Token is required to initialize connection.' });
  }

  try {
    let finalToken = accessToken;

    // 1. Exchange short-lived token for a long-lived user access token (if credentials exist)
    if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
      try {
        const exchangeUrl = 'https://graph.facebook.com/v19.0/oauth/access_token';
        const exchangeRes = await axios.get(exchangeUrl, {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: process.env.FACEBOOK_APP_ID,
            client_secret: process.env.FACEBOOK_APP_SECRET,
            fb_exchange_token: accessToken,
          },
          timeout: 10000
        });
        if (exchangeRes.data.access_token) {
          finalToken = exchangeRes.data.access_token;
        }
      } catch (err) {
        console.warn('[WhatsApp Connect] Exchange token failed, using original token:', err.response?.data || err.message);
      }
    }

    // 2. Fetch WhatsApp Business Accounts (WABA) for this token
    const wabaUrl = 'https://graph.facebook.com/v19.0/me/whatsapp_business_accounts';
    const wabaRes = await axios.get(wabaUrl, {
      headers: { 'Authorization': `Bearer ${finalToken}` },
      timeout: 10000
    });

    const wabaAccounts = wabaRes.data?.data || [];
    if (wabaAccounts.length === 0) {
      return res.status(400).json({ 
        message: 'No WhatsApp Business Accounts (WABA) found associated with this Facebook profile. Ensure you completed the onboarding steps.' 
      });
    }

    // Auto-select the first WABA account
    const activeWaba = wabaAccounts[0];
    const wabaId = activeWaba.id;
    const businessName = activeWaba.name || 'Mohuri WhatsApp Account';

    // 3. Fetch Phone Numbers under this WABA ID
    const phoneUrl = `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers`;
    const phoneRes = await axios.get(phoneUrl, {
      headers: { 'Authorization': `Bearer ${finalToken}` },
      timeout: 10000
    });

    const phoneNumbers = phoneRes.data?.data || [];
    if (phoneNumbers.length === 0) {
      return res.status(400).json({
        message: `No WhatsApp phone numbers found registered under WABA ID ${wabaId}. Please add a phone number in your Meta Business Suite.`
      });
    }

    // Auto-select the first registered phone number
    const activePhone = phoneNumbers[0];
    const phoneNumberId = activePhone.id;
    const phoneNumber = activePhone.display_phone_number || '';

    // 4. Retrieve Business Portfolio ID (owner_business_info)
    let businessId = '';
    try {
      const detailsUrl = `https://graph.facebook.com/v19.0/${wabaId}`;
      const detailsRes = await axios.get(detailsUrl, {
        params: { fields: 'owner_business_info' },
        headers: { 'Authorization': `Bearer ${finalToken}` },
        timeout: 10000
      });
      businessId = detailsRes.data?.owner_business_info?.id || '';
    } catch (err) {
      console.warn('[WhatsApp Connect] Failed to retrieve business portfolio info:', err.message);
    }

    // 5. Encrypt access token securely
    const encryptedToken = encrypt(finalToken);

    // 6. Update or insert connection record in database
    let connection = await WhatsAppConnection.findOne({ userId: req.user._id });
    if (connection) {
      connection.businessId = businessId;
      connection.wabaId = wabaId;
      connection.phoneNumberId = phoneNumberId;
      connection.accessToken = encryptedToken;
      connection.phoneNumber = phoneNumber;
      connection.businessName = businessName;
      await connection.save();
    } else {
      connection = new WhatsAppConnection({
        userId: req.user._id,
        businessId,
        wabaId,
        phoneNumberId,
        accessToken: encryptedToken,
        phoneNumber,
        businessName,
      });
      await connection.save();
    }

    res.status(200).json({
      success: true,
      message: 'WhatsApp Business Account successfully connected to Mohuri!',
      connection: {
        wabaId,
        phoneNumberId,
        phoneNumber,
        businessName,
        businessId,
        connectedAt: connection.connectedAt,
      }
    });

  } catch (error) {
    const errorDetails = error.response ? error.response.data : error.message;
    console.error('[WhatsApp Connect] Connection setup failed:', errorDetails);
    res.status(500).json({
      message: 'Failed to complete WhatsApp onboarding. Verify your Facebook Login permissions.',
      error: errorDetails
    });
  }
};

/**
 * @desc    Fetch current WhatsApp connection status
 * @route   GET /api/whatsapp/status
 * @access  Private
 */
const getConnectionStatus = async (req, res) => {
  try {
    const connection = await WhatsAppConnection.findOne({ userId: req.user._id });

    if (connection) {
      res.status(200).json({
        connected: true,
        type: 'automated',
        connection: {
          wabaId: connection.wabaId,
          phoneNumberId: connection.phoneNumberId,
          phoneNumber: connection.phoneNumber,
          businessName: connection.businessName,
          businessId: connection.businessId,
          connectedAt: connection.connectedAt,
        }
      });
    } else if (req.user.whatsappToken && req.user.whatsappPhoneNumberId) {
      res.status(200).json({
        connected: true,
        type: 'manual',
        connection: {
          wabaId: 'Manual Config',
          phoneNumberId: req.user.whatsappPhoneNumberId,
          phoneNumber: req.user.businessPhone || 'N/A',
          businessName: req.user.businessName || req.user.name || 'Mohuri Store',
          businessId: 'Manual',
          connectedAt: req.user.updatedAt,
        }
      });
    } else {
      res.status(200).json({ connected: false });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Disconnect WhatsApp connection
 * @route   DELETE /api/whatsapp/disconnect
 * @access  Private
 */
const disconnectWhatsApp = async (req, res) => {
  try {
    const result = await WhatsAppConnection.deleteOne({ userId: req.user._id });
    
    // Also clear manual config in User model
    const user = await User.findById(req.user._id);
    let clearedManual = false;
    if (user && (user.whatsappToken || user.whatsappPhoneNumberId)) {
      user.whatsappToken = '';
      user.whatsappPhoneNumberId = '';
      await user.save();
      clearedManual = true;
    }

    if (result.deletedCount > 0 || clearedManual) {
      res.status(200).json({ success: true, message: 'WhatsApp connection disconnected successfully.' });
    } else {
      res.status(404).json({ message: 'No active WhatsApp connection found to disconnect.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @desc    Test connection by sending a welcome diagnostic message
 * @route   POST /api/whatsapp/test-embedded
 * @access  Private
 */
const testEmbeddedConnection = async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ message: 'Please provide a target phone number.' });
  }

  try {
    const connection = await WhatsAppConnection.findOne({ userId: req.user._id });
    
    let token = '';
    let phoneNumberId = '';
    let isManual = false;

    if (connection) {
      token = decrypt(connection.accessToken);
      phoneNumberId = connection.phoneNumberId;
    } else if (req.user.whatsappToken && req.user.whatsappPhoneNumberId) {
      token = req.user.whatsappToken;
      phoneNumberId = req.user.whatsappPhoneNumberId;
      isManual = true;
    } else {
      return res.status(400).json({ message: 'No active WhatsApp connection found. Connect your account first.' });
    }

    const testMessage = `Hello! This is a test message from your SaaS billing application Mohuri.\n\nYour WhatsApp connection is fully verified and active! 🎉\n\nConnection Type: ${isManual ? 'Manual' : 'Embedded Signup'}\nPhone ID: ${phoneNumberId}`;

    const dispatchResult = await sendWhatsAppMessage({
      phoneNumberId,
      accessToken: token,
      to,
      message: testMessage,
    });

    if (dispatchResult.success) {
      res.status(200).json({
        success: true,
        message: `Test message successfully dispatched to ${to}! Message ID: ${dispatchResult.messageId}`
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Meta API rejected connection dispatch.',
        error: dispatchResult.error
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  connectWhatsApp,
  getConnectionStatus,
  disconnectWhatsApp,
  testEmbeddedConnection,
};

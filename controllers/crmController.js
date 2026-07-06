const Campaign = require('../models/Campaign');
const Customer = require('../models/Customer');
const Bill = require('../models/Bill');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const { decrypt } = require('../services/encryptionService');
const { sendWhatsAppMessage, uploadWhatsAppMedia } = require('../services/whatsappService');

// @desc    Get CRM Statistics
// @route   GET /api/crm/stats
// @access  Private
const getCRMStats = async (req, res) => {
  try {
    // 1. Connection status
    const connection = await WhatsAppConnection.findOne({ userId: req.user._id });
    let isConnected = false;
    let type = 'none';
    let phoneNumber = 'N/A';

    if (connection) {
      isConnected = true;
      type = 'automated';
      phoneNumber = connection.phoneNumber || 'N/A';
    } else if (req.user.whatsappToken && req.user.whatsappPhoneNumberId) {
      isConnected = true;
      type = 'manual';
      phoneNumber = req.user.businessPhone || 'N/A';
    }

    // 2. Total customers
    const totalCustomers = await Customer.countDocuments({ userId: req.user._id });

    // 3. Campaigns sent count
    const campaignsCount = await Campaign.countDocuments({ userId: req.user._id });

    // 4. Messages sent count (aggregate recipientsCount across campaigns)
    const campaigns = await Campaign.find({ userId: req.user._id });
    const totalMessagesSent = campaigns.reduce((sum, c) => sum + (c.recipientsCount || 0), 0);

    res.status(200).json({
      isConnected,
      connectionType: type,
      phoneNumber,
      totalCustomers,
      campaignsCount,
      totalMessagesSent,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get Customers list categorized by Segments
// @route   GET /api/crm/segments
// @access  Private
const getSegmentCustomers = async (req, res) => {
  const { segment } = req.query; // all, recent, credit, inactive

  try {
    let query = { userId: req.user._id };
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    if (segment === 'recent') {
      // Created in the last 30 days
      query.createdAt = { $gte: thirtyDaysAgo };
      const customers = await Customer.find(query).sort({ name: 1 });
      return res.json(customers);
    } 
    
    if (segment === 'credit') {
      // Customers with outstanding credit
      const creditBills = await Bill.find({ 
        userId: req.user._id, 
        remainingAmount: { $gt: 0 } 
      });
      const uniquePhones = [...new Set(creditBills.map(b => b.customerPhone).filter(Boolean))];
      query.phone = { $in: uniquePhones };
      const customers = await Customer.find(query).sort({ name: 1 });
      return res.json(customers);
    } 
    
    if (segment === 'inactive') {
      // No bills generated in the last 30 days
      const recentBills = await Bill.find({ 
        userId: req.user._id, 
        createdAt: { $gte: thirtyDaysAgo } 
      });
      const activePhones = [...new Set(recentBills.map(b => b.customerPhone).filter(Boolean))];
      query.phone = { $nin: activePhones };
      const customers = await Customer.find(query).sort({ name: 1 });
      return res.json(customers);
    }

    // Default 'all'
    const customers = await Customer.find(query).sort({ name: 1 });
    res.json(customers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create and send a new campaign
// @route   POST /api/crm/campaigns
// @access  Private
const createCampaign = async (req, res) => {
  const { name, message, recipients, image } = req.body; // recipients: Array of { name, phone }, image: base64 string (optional)

  if (!name || !message || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ message: 'Name, message, and a non-empty recipients list are required.' });
  }

  try {
    // 1. Get WhatsApp credentials
    const connection = await WhatsAppConnection.findOne({ userId: req.user._id });
    let token = '';
    let phoneNumberId = '';

    if (connection) {
      token = decrypt(connection.accessToken);
      phoneNumberId = connection.phoneNumberId;
    } else if (req.user.whatsappToken && req.user.whatsappPhoneNumberId) {
      token = req.user.whatsappToken;
      phoneNumberId = req.user.whatsappPhoneNumberId;
    } else {
      return res.status(400).json({ message: 'No active WhatsApp connection found. Connect your WhatsApp account first.' });
    }

    // 2. Upload image to Meta if present
    let mediaId = '';
    if (image) {
      const regex = /^data:(image\/\w+);base64,(.+)$/;
      const matches = image.match(regex);
      if (matches) {
        const mimeType = matches[1];
        const base64Data = matches[2];
        const buffer = Buffer.from(base64Data, 'base64');
        
        const uploadResult = await uploadWhatsAppMedia({
          phoneNumberId,
          accessToken: token,
          buffer,
          mimeType
        });
        
        if (uploadResult.success) {
          mediaId = uploadResult.mediaId;
        } else {
          return res.status(400).json({ message: `Image upload to Meta failed: ${uploadResult.error}` });
        }
      } else {
        return res.status(400).json({ message: 'Invalid image format. Must be a base64 data URI.' });
      }
    }

    // 3. Loop and dispatch message to each recipient
    const recipientLogs = [];
    let successfulSends = 0;

    for (const recipient of recipients) {
      if (!recipient.phone || !recipient.name) {
        recipientLogs.push({
          name: recipient.name || 'Unknown',
          phone: recipient.phone || 'N/A',
          status: 'failed',
          error: 'Missing name or phone number',
        });
        continue;
      }

      // Check if it's Sandbox Mode (no credentials provided or fallback to system environment variables)
      const dispatchResult = await sendWhatsAppMessage({
        phoneNumberId,
        accessToken: token,
        to: recipient.phone,
        message: message,
        mediaId: mediaId || undefined,
        mediaType: 'image'
      });

      if (dispatchResult.success) {
        successfulSends++;
        recipientLogs.push({
          name: recipient.name,
          phone: recipient.phone,
          status: 'sent',
        });
      } else {
        recipientLogs.push({
          name: recipient.name,
          phone: recipient.phone,
          status: 'failed',
          error: dispatchResult.error || 'Meta API rejected dispatch',
        });
      }
    }

    // 4. Create Campaign entry in DB
    const campaign = new Campaign({
      userId: req.user._id,
      name,
      message,
      image: image || '',
      recipientsCount: successfulSends,
      status: successfulSends === recipients.length ? 'completed' : (successfulSends > 0 ? 'processing' : 'failed'),
      recipients: recipientLogs,
    });

    const savedCampaign = await campaign.save();

    // Create notification
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        user: req.user._id,
        title: 'WhatsApp Campaign Dispatched',
        message: `Campaign "${name}" has been processed. Successfully sent to ${successfulSends}/${recipients.length} recipients.`,
        type: 'campaign',
        link: '/crm'
      });
    } catch (notifErr) {
      console.error('Failed to create campaign notification:', notifErr);
    }

    res.status(201).json(savedCampaign);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all campaigns history
// @route   GET /api/crm/campaigns
// @access  Private
const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCRMStats,
  getSegmentCustomers,
  createCampaign,
  getCampaigns,
};

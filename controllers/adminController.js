const User = require('../models/User');
const Bill = require('../models/Bill');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Campaign = require('../models/Campaign');
const Notification = require('../models/Notification');

// @desc    Get Admin Dashboard aggregate statistics
// @route   GET /api/admin/stats
// @access  Private/Admin
const getDashboardStats = async (req, res) => {
  try {
    const totalMerchants = await User.countDocuments({ isAdmin: { $ne: true } });
    const verifiedMerchants = await User.countDocuments({ isAdmin: { $ne: true }, isVerified: true });
    const unverifiedMerchants = await User.countDocuments({ isAdmin: { $ne: true }, isVerified: false });
    const blockedMerchants = await User.countDocuments({ isAdmin: { $ne: true }, isBlocked: true });
    
    const totalBills = await Bill.countDocuments();
    const totalProducts = await Product.countDocuments();
    const totalCustomers = await Customer.countDocuments();
    const totalCampaigns = await Campaign.countDocuments();

    // Calculate total transactional revenue processed by the platform
    const bills = await Bill.find({}, 'total');
    const totalRevenue = bills.reduce((sum, bill) => sum + (bill.total || 0), 0);

    // Group signup growth for the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const merchantGrowth = await User.aggregate([
      { 
        $match: { 
          isAdmin: { $ne: true },
          createdAt: { $gte: sevenDaysAgo } 
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Group invoice generations for the last 7 days
    const invoiceGrowth = await Bill.aggregate([
      { 
        $match: { 
          createdAt: { $gte: sevenDaysAgo } 
        } 
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
          amount: { $sum: "$total" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      merchants: {
        total: totalMerchants,
        verified: verifiedMerchants,
        unverified: unverifiedMerchants,
        blocked: blockedMerchants
      },
      platform: {
        totalBills,
        totalProducts,
        totalCustomers,
        totalCampaigns,
        totalRevenue
      },
      growth: {
        merchants: merchantGrowth,
        invoices: invoiceGrowth
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Helper to escape regex special characters
const escapeRegex = (text) => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

// @desc    Get paginated, searchable list of all store owners / merchants
// @route   GET /api/admin/merchants
// @access  Private/Admin
const getMerchants = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;
  const search = req.query.search || '';

  const query = { isAdmin: { $ne: true } };

  const cleanTerm = search.trim().replace(/^#/, '');
  if (cleanTerm) {
    const escaped = escapeRegex(cleanTerm);
    const regex = new RegExp(escaped, 'i');
    query.$or = [
      { name: regex },
      { email: regex },
      { businessPhone: regex },
      { businessName: regex },
      { storeName: regex },
      { businessEmail: regex },
      { gstin: regex },
      { storeToken: regex },
      { upiId: regex },
      { $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: escaped, options: 'i' } } }
    ];
  }

  try {
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password -otp -otpExpires -resetPasswordOtp -resetPasswordOtpExpires')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Map counts of assets (Bills, Products, Customers) and revenue for each merchant
    const merchants = await Promise.all(users.map(async (u) => {
      const userFilter = { $or: [{ userId: u._id }, { user: u._id }] };
      const productsCount = await Product.countDocuments(userFilter);
      const customersCount = await Customer.countDocuments(userFilter);
      const billsCount = await Bill.countDocuments(userFilter);
      
      const bills = await Bill.find(userFilter, 'total');
      const totalRevenue = bills.reduce((sum, b) => sum + (b.total || 0), 0);
      
      return {
        ...u.toObject(),
        productsCount,
        customersCount,
        billsCount,
        totalRevenue
      };
    }));

    res.json({
      merchants,
      page,
      pages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get complete merchant details including their products, bills, and customers
// @route   GET /api/admin/merchants/:id
// @access  Private/Admin
const getMerchantById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -otp -otpExpires -resetPasswordOtp -resetPasswordOtpExpires');

    if (!user) {
      return res.status(404).json({ message: 'Merchant not found' });
    }

    const userFilter = { $or: [{ userId: user._id }, { user: user._id }] };

    const [
      productsCount,
      customersCount,
      billsCount,
      products,
      bills,
      customers
    ] = await Promise.all([
      Product.countDocuments(userFilter),
      Customer.countDocuments(userFilter),
      Bill.countDocuments(userFilter),
      Product.find(userFilter).sort({ createdAt: -1 }).limit(20),
      Bill.find(userFilter).sort({ createdAt: -1 }).limit(20),
      Customer.find(userFilter).sort({ createdAt: -1 }).limit(20)
    ]);

    const totalRevenue = bills.reduce((sum, b) => sum + (b.total || 0), 0);

    res.json({
      merchant: user,
      stats: {
        productsCount,
        customersCount,
        billsCount,
        totalRevenue
      },
      products,
      bills,
      customers
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Toggle block/suspension or verification status of a merchant
// @route   PUT /api/admin/merchants/:id/status
// @access  Private/Admin
const updateMerchantStatus = async (req, res) => {
  const { isVerified, isBlocked } = req.body;

  try {
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'Merchant not found' });
    }

    if (user.isAdmin) {
      return res.status(400).json({ message: 'Cannot modify status of an admin account' });
    }

    if (typeof isVerified === 'boolean') {
      user.isVerified = isVerified;
    }

    if (typeof isBlocked === 'boolean') {
      user.isBlocked = isBlocked;
    }

    await user.save();

    res.json({
      message: 'Merchant status updated successfully',
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
        isBlocked: user.isBlocked
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Broadcast a dashboard notification to all active store owners
// @route   POST /api/admin/broadcast
// @access  Private/Admin
const broadcastMessage = async (req, res) => {
  const { title, message, type = 'system_alert', link = '' } = req.body;

  if (!title || !message) {
    return res.status(400).json({ message: 'Please provide both announcement title and message' });
  }

  try {
    // Find all non-admin users
    const users = await User.find({ isAdmin: { $ne: true } });

    if (users.length === 0) {
      return res.json({ message: 'No active merchants found to broadcast to.' });
    }

    // Build notifications list
    const notifications = users.map((u) => ({
      user: u._id,
      type,
      title,
      message,
      link,
      isRead: false
    }));

    // Bulk insert notifications
    await Notification.insertMany(notifications);

    res.json({
      message: `Broadcast message sent successfully to all ${users.length} registered merchants.`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getDashboardStats,
  getMerchants,
  getMerchantById,
  updateMerchantStatus,
  broadcastMessage
};

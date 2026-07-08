const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOtpEmail } = require('../config/emailService');

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a new user (unverified by default)
// @route   POST /api/auth/register
// @access  Public
const registerUser = async (req, res) => {
  const { name, email, password, businessPhone } = req.body;

  try {
    if (!name || !email || !password || !businessPhone) {
      return res.status(400).json({ message: 'Please add all fields including contact number' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if a VERIFIED user exists with same email
    const verifiedUserExists = await User.findOne({
      email: email.toLowerCase(),
      isVerified: true
    });

    if (verifiedUserExists) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Find if an UNVERIFIED record exists to reuse/update
    let user = await User.findOne({
      email: email.toLowerCase(),
      isVerified: false
    });

    if (user) {
      // Reuse the unverified record
      user.name = name;
      user.password = password; // Pre-save hook hashes this on save
      user.businessPhone = businessPhone;
    } else {
      // Create new user
      user = new User({
        name,
        email: email.toLowerCase(),
        password,
        businessPhone,
      });
    }

    // Generate numeric 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    await user.save();

    // Trigger sending the email in background
    sendOtpEmail(user.email, otp);

    res.status(200).json({
      message: 'Verification OTP sent to your email',
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Authenticate a user (Email only)
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    if (!email || !password) {
      return res.status(400).json({ message: 'Please include email and password' });
    }

    // Search for user by email only
    const user = await User.findOne({ email: email.toLowerCase() });

    if (user && (await user.matchPassword(password))) {
      if (user.isBlocked) {
        return res.status(403).json({ message: 'Your account has been suspended. Please contact support.' });
      }

      // If user is not verified, block login and send new OTP
      if (!user.isVerified) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
        await user.save();

        sendOtpEmail(user.email, otp);

        return res.status(401).json({
          unverified: true,
          message: 'Please verify your email first. A new OTP has been sent.',
          email: user.email,
        });
      }

      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Verify OTP and activate account
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    if (!email || !otp) {
      return res.status(400).json({ message: 'Please provide email and OTP' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: false });

    if (!user) {
      return res.status(400).json({ message: 'Invalid request or user already verified' });
    }

    if (user.otp !== otp || user.otpExpires < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Activate the user
    user.isVerified = true;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Resend OTP to unverified user
// @route   POST /api/auth/resend-otp
// @access  Public
const resendOtp = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ message: 'Please provide email' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: false });

    if (!user) {
      return res.status(400).json({ message: 'User not found or already verified' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    sendOtpEmail(user.email, otp);

    res.status(200).json({ message: 'OTP resent successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Forgot Password - Send OTP to email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ message: 'Please provide email' });
    }

    // Check if verified user exists
    const user = await User.findOne({ email: email.toLowerCase(), isVerified: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found with this email' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordOtp = otp;
    user.resetPasswordOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await user.save();

    // Send Email using Nodemailer emailService (configured as reset type)
    sendOtpEmail(user.email, otp, 'reset');

    res.status(200).json({
      message: 'Password reset OTP sent to your email',
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Reset Password using OTP
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Please add all fields' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const user = await User.findOne({ email: email.toLowerCase(), isVerified: true });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.resetPasswordOtp !== otp || user.resetPasswordOtpExpires < new Date()) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Reset the password
    user.password = newPassword; // Pre-save hook hashes it automatically!
    user.resetPasswordOtp = undefined;
    user.resetPasswordOtpExpires = undefined;
    await user.save();

    res.status(200).json({ message: 'Password reset successful' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get user data
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    res.status(200).json(req.user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update user profile details
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res) => {
  const { 
    name,
    businessName, 
    whatsappToken, 
    whatsappPhoneNumberId,
    businessAddress,
    businessPhone,
    gstin,
    invoiceFooter,
    logo,
    whatsappBillTemplate,
    whatsappReminderTemplate,
    primaryColor,
    secondaryColor,
    upiId,
    upiName,
    enableInvoiceQr,
    enableWhatsappQr
  } = req.body;

  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.name = name !== undefined ? name : user.name;
      user.businessName = businessName !== undefined ? businessName : user.businessName;
      user.whatsappToken = whatsappToken !== undefined ? whatsappToken : user.whatsappToken;
      user.whatsappPhoneNumberId = whatsappPhoneNumberId !== undefined ? whatsappPhoneNumberId : user.whatsappPhoneNumberId;
      user.businessAddress = businessAddress !== undefined ? businessAddress : user.businessAddress;
      user.businessPhone = businessPhone !== undefined ? businessPhone : user.businessPhone;
      user.gstin = gstin !== undefined ? gstin : user.gstin;
      user.invoiceFooter = invoiceFooter !== undefined ? invoiceFooter : user.invoiceFooter;
      user.logo = logo !== undefined ? logo : user.logo;
      user.whatsappBillTemplate = whatsappBillTemplate !== undefined ? whatsappBillTemplate : user.whatsappBillTemplate;
      user.whatsappReminderTemplate = whatsappReminderTemplate !== undefined ? whatsappReminderTemplate : user.whatsappReminderTemplate;
      user.primaryColor = primaryColor !== undefined ? primaryColor : user.primaryColor;
      user.secondaryColor = secondaryColor !== undefined ? secondaryColor : user.secondaryColor;
      user.upiId = upiId !== undefined ? upiId : user.upiId;
      user.upiName = upiName !== undefined ? upiName : user.upiName;
      user.enableInvoiceQr = enableInvoiceQr !== undefined ? enableInvoiceQr : user.enableInvoiceQr;
      user.enableWhatsappQr = enableWhatsappQr !== undefined ? enableWhatsappQr : user.enableWhatsappQr;

      const updatedUser = await user.save();
      res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        businessName: updatedUser.businessName,
        whatsappToken: updatedUser.whatsappToken,
        whatsappPhoneNumberId: updatedUser.whatsappPhoneNumberId,
        businessAddress: updatedUser.businessAddress,
        businessPhone: updatedUser.businessPhone,
        gstin: updatedUser.gstin,
        invoiceFooter: updatedUser.invoiceFooter,
        logo: updatedUser.logo,
        whatsappBillTemplate: updatedUser.whatsappBillTemplate,
        whatsappReminderTemplate: updatedUser.whatsappReminderTemplate,
        primaryColor: updatedUser.primaryColor,
        secondaryColor: updatedUser.secondaryColor,
        upiId: updatedUser.upiId,
        upiName: updatedUser.upiName,
        enableInvoiceQr: updatedUser.enableInvoiceQr,
        enableWhatsappQr: updatedUser.enableWhatsappQr,
      });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Test WhatsApp Cloud API Connection
// @route   POST /api/auth/test-whatsapp
// @access  Private
const testWhatsapp = async (req, res) => {
  const { phone, whatsappToken, whatsappPhoneNumberId } = req.body;

  if (!phone) {
    return res.status(400).json({ message: 'Please provide a target phone number' });
  }

  // Use values from request body (unsaved/preview) or fallback to saved credentials
  const token = whatsappToken !== undefined ? whatsappToken.trim() : req.user.whatsappToken;
  const phoneNumberId = whatsappPhoneNumberId !== undefined ? whatsappPhoneNumberId.trim() : req.user.whatsappPhoneNumberId;
  const businessName = req.user.businessName || req.user.name || 'Test Store';

  try {
    const { sendWhatsappBill } = require('../services/whatsappService');
    const dummyPdf = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    
    const result = await sendWhatsappBill(
      phone,
      'Test Customer',
      99.00,
      dummyPdf,
      businessName,
      { whatsappToken: token, whatsappPhoneNumberId: phoneNumberId }
    );

    if (result.success) {
      res.json({
        success: true,
        message: result.sandbox 
          ? 'Sandbox mode active. Check backend console logs to see the test output.' 
          : `Test message sent successfully! Message ID: ${result.messageId}`
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to send WhatsApp message.'
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  registerUser,
  loginUser,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  testWhatsapp,
};

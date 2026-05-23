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
  const { name, email, phone, password } = req.body;

  try {
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ message: 'Please add all fields' });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    // Check if a VERIFIED user exists with same email or phone
    const verifiedUserExists = await User.findOne({
      isVerified: true,
      $or: [
        { email: email.toLowerCase() },
        { phone }
      ]
    });

    if (verifiedUserExists) {
      return res.status(400).json({ message: 'Email or Phone Number already registered' });
    }

    // Find if an UNVERIFIED record exists to reuse/update
    let user = await User.findOne({
      isVerified: false,
      $or: [
        { email: email.toLowerCase() },
        { phone }
      ]
    });

    if (user) {
      // Reuse the unverified record
      user.name = name;
      user.email = email.toLowerCase();
      user.phone = phone;
      user.password = password; // Pre-save hook will auto-hash this on save
    } else {
      // Create new user
      user = new User({
        name,
        email: email.toLowerCase(),
        phone,
        password,
      });
    }

    // Generate numeric 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otp = otp;
    user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    await user.save();

    // Trigger sending the email in background
    await sendOtpEmail(user.email, otp);

    res.status(200).json({
      message: 'Verification OTP sent to your email',
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Authenticate a user (supports both Email and Phone)
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res) => {
  const { email, username, password } = req.body;
  const loginIdentifier = username || email;

  try {
    if (!loginIdentifier || !password) {
      return res.status(400).json({ message: 'Please include credentials and password' });
    }

    // Search for user by either email or phone
    const user = await User.findOne({
      $or: [
        { email: loginIdentifier.toLowerCase() },
        { phone: loginIdentifier }
      ]
    });

    if (user && (await user.matchPassword(password))) {
      // If user is not verified, block login and send new OTP
      if (!user.isVerified) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
        await user.save();

        await sendOtpEmail(user.email, otp);

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
        phone: user.phone,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid credentials or password' });
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
      phone: user.phone,
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

    await sendOtpEmail(user.email, otp);

    res.status(200).json({ message: 'OTP resent successfully' });
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

module.exports = {
  registerUser,
  loginUser,
  verifyOtp,
  resendOtp,
  getMe,
};

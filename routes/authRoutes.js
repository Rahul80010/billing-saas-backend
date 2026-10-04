const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword,
  getMe,
  updateProfile,
  testWhatsapp,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// Rate limiter for authentication attempts (15 mins window, 25 requests)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login or registration attempts. Please try again in 15 minutes.' }
});

// Strict rate limiter for OTP verification & resending (15 mins window, 15 requests)
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many OTP requests. Please try again after 15 minutes.' }
});

router.post('/register', authLimiter, registerUser);
router.post('/login', authLimiter, loginUser);
router.post('/verify-otp', otpLimiter, verifyOtp);
router.post('/resend-otp', otpLimiter, resendOtp);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', otpLimiter, resetPassword);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/test-whatsapp', protect, testWhatsapp);

// Diagnostic route to synchronously test email sending (Restricted to Admin Only, SSRF-safe)
router.post('/test-email', protect, (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: 'Not authorized as an admin' });
  }
  next();
}, async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Please provide a valid target email address' });
  }

  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"MOHURI by Detalogy" <noreply@mohuri.com>`;

  if (!user || !pass || !host) {
    return res.status(400).json({
      error: 'SMTP credentials are not configured in server environment'
    });
  }

  try {
    const isSecure = Number(port) === 465;
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: isSecure,
      auth: {
        user,
        pass,
      },
      tls: {
        servername: host,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    const info = await transporter.sendMail({
      from,
      to: email,
      subject: `MOHURI SMTP Diagnostic Test`,
      text: `MOHURI SMTP diagnostic verification email. Port: ${port}, Secure: ${isSecure}`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #10b981;">SMTP Configuration Verified!</h2>
          <p>Congratulations! Your SMTP integration is fully functional.</p>
        </div>
      `
    });

    res.json({
      success: true,
      messageId: info.messageId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to send diagnostic test email. Check server SMTP settings.',
    });
  }
});

module.exports = router;

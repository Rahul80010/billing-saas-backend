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
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);

// Safe debugging route to check live environment variable mapping
router.get('/debug-smtp', (req, res) => {
  res.json({
    smtp_host: process.env.SMTP_HOST || 'not defined',
    smtp_port: process.env.SMTP_PORT || 'not defined',
    smtp_user: process.env.SMTP_USER || 'not defined',
    smtp_pass_exists: !!process.env.SMTP_PASS,
    smtp_from: process.env.SMTP_FROM || 'not defined',
    node_env: process.env.NODE_ENV || 'not defined',
    jwt_secret_exists: !!process.env.JWT_SECRET
  });
});

// Diagnostic route to synchronously test email sending and catch SMTP errors
router.post('/test-email', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Please provide a target email address' });
  }

  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"BillSaaS" <noreply@billsaas.com>`;

  if (!user || !pass) {
    return res.status(400).json({
      error: 'SMTP credentials are not configured in environment variables (SMTP_USER or SMTP_PASS is missing)'
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: {
        user,
        pass,
      },
    });

    const info = await transporter.sendMail({
      from,
      to: email,
      subject: 'BillSaaS SMTP Diagnostic Test',
      text: 'If you are reading this email, your SMTP setup is 100% correct and active!',
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #10b981;">SMTP Configuration Verified!</h2>
          <p>Congratulations! Your Gmail SMTP integration is fully functional.</p>
          <p>Sent via: <strong>${user}</strong> on host <strong>${host}:${port}</strong></p>
        </div>
      `
    });

    res.json({
      success: true,
      messageId: info.messageId,
      response: info.response,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      command: error.command,
      stack: error.stack,
    });
  }
});

module.exports = router;

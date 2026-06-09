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

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.post('/test-whatsapp', protect, testWhatsapp);

// Safe debugging route to check live environment variable mapping
router.get('/debug-smtp', (req, res) => {
  res.json({
    smtp_host: process.env.SMTP_HOST || 'not defined',
    smtp_port: process.env.SMTP_PORT || 'not defined',
    smtp_user: process.env.SMTP_USER || 'not defined',
    smtp_pass_exists: !!process.env.SMTP_PASS,
    smtp_from: process.env.SMTP_FROM || 'not defined',
    resend_api_key_exists: !!process.env.RESEND_API_KEY,
    resend_from: process.env.RESEND_FROM || 'not defined',
    node_env: process.env.NODE_ENV || 'not defined',
    jwt_secret_exists: !!process.env.JWT_SECRET
  });
});

// Temporary endpoint to check live code
router.get('/debug-code', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const code = fs.readFileSync(path.join(__dirname, '../config/emailService.js'), 'utf8');
    res.send(code);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Diagnostic route to synchronously test email sending and catch SMTP errors
router.post('/test-email', async (req, res) => {
  const { email, host: overrideHost, port: overridePort, user: overrideUser, pass: overridePass } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Please provide a target email address' });
  }

  const nodemailer = require('nodemailer');
  const host = overrideHost || process.env.SMTP_HOST;
  const port = overridePort || process.env.SMTP_PORT || 587;
  const user = overrideUser || process.env.SMTP_USER;
  const pass = overridePass || process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || `"MOHURI by Detalogy" <noreply@mohuri.com>`;

  if (!user || !pass) {
    return res.status(400).json({
      error: 'SMTP credentials are not configured (SMTP_USER or SMTP_PASS is missing)'
    });
  }

  try {
    const dns = require('dns').promises;
    let resolvedHost = host;
    try {
      const lookupResult = await dns.lookup(host, { family: 4 });
      resolvedHost = lookupResult.address;
    } catch (dnsErr) {
      console.warn('DNS lookup failed in test-email:', dnsErr.message);
    }

    const isSecure = Number(port) === 465;
    const transporter = nodemailer.createTransport({
      host: resolvedHost,
      port: Number(port),
      secure: isSecure,
      auth: {
        user,
        pass,
      },
      tls: {
        servername: host,
      },
      // Increase timeout to 10 seconds to fail faster if blocked
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    const info = await transporter.sendMail({
      from: overrideUser ? `"MOHURI Test" <${overrideUser}>` : from,
      to: email,
      subject: `MOHURI SMTP Diagnostic Test (Port ${port})`,
      text: `If you are reading this email, your SMTP setup is 100% correct and active! (Port: ${port}, Secure: ${isSecure})`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #10b981;">SMTP Configuration Verified!</h2>
          <p>Congratulations! Your Gmail SMTP integration is fully functional.</p>
          <p>Sent via: <strong>${user}</strong> on host <strong>${host}:${port}</strong> (Secure: ${isSecure})</p>
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

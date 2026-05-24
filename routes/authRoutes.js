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

module.exports = router;

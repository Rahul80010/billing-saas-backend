const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  verifyOtp,
  resendOtp,
  getMe,
} = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/verify-otp', verifyOtp);
router.post('/resend-otp', resendOtp);
router.get('/me', protect, getMe);

module.exports = router;

const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
  getDashboardStats,
  getMerchants,
  updateMerchantStatus,
  broadcastMessage
} = require('../controllers/adminController');

// Apply protection and admin verification middleware to all routes in this router
router.use(protect);
router.use(admin);

// Admin Action Routes
router.get('/stats', getDashboardStats);
router.get('/merchants', getMerchants);
router.put('/merchants/:id/status', updateMerchantStatus);
router.post('/broadcast', broadcastMessage);

module.exports = router;

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getCRMStats,
  getSegmentCustomers,
  createCampaign,
  getCampaigns,
} = require('../controllers/crmController');

// All CRM routes require authentication
router.use(protect);

router.get('/stats', getCRMStats);
router.get('/segments', getSegmentCustomers);
router.get('/campaigns', getCampaigns);
router.post('/campaigns', createCampaign);

module.exports = router;

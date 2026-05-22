const express = require('express');
const router = express.Router();
const {
  getBills,
  createBill,
} = require('../controllers/billController');
const { protect } = require('../middleware/authMiddleware');

// Protect all routes
router.use(protect);

router.route('/').get(getBills).post(createBill);

module.exports = router;

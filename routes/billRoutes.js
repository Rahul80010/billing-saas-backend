const express = require('express');
const router = express.Router();
const {
  getBills,
  createBill,
  getBillPdf,
  getCreditStats,
  recordPayment,
  recordCustomerPayment,
  deleteBill,
} = require('../controllers/billController');
const { protect } = require('../middleware/authMiddleware');

// Public route for dynamic PDF download
router.get('/:id/pdf', getBillPdf);

// Protect all other routes
router.use(protect);

router.get('/credit/stats', getCreditStats);
router.post('/customer/:phone/payments', recordCustomerPayment);
router.post('/:id/payments', recordPayment);

router.route('/').get(getBills).post(createBill);
router.route('/:id').delete(deleteBill);

module.exports = router;

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
  sendBillWhatsAppReminder,
  sendCustomerWhatsAppReminder,
  updateBillReminderDate,
  updateCustomerReminderDate,
  parseVoiceBill,
} = require('../controllers/billController');
const { protect } = require('../middleware/authMiddleware');

// Public route for dynamic PDF download
router.get('/:id/pdf', getBillPdf);

// Protect all other routes
router.use(protect);

router.post('/parse-voice', parseVoiceBill);
router.get('/credit/stats', getCreditStats);
router.post('/customer/:phone/payments', recordCustomerPayment);
router.post('/customer/:phone/whatsapp-reminder', sendCustomerWhatsAppReminder);
router.put('/customer/:phone/reminder-date', updateCustomerReminderDate);
router.post('/:id/payments', recordPayment);
router.post('/:id/whatsapp-reminder', sendBillWhatsAppReminder);
router.put('/:id/reminder-date', updateBillReminderDate);

router.route('/').get(getBills).post(createBill);
router.route('/:id').delete(deleteBill);

module.exports = router;

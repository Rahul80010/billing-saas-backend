const express = require('express');
const router = express.Router();
const {
  verifyWebhook,
  handleWebhookPayload,
} = require('../controllers/webhookController');

// Public routes for Meta Webhook setup and dispatches
router.get('/whatsapp', verifyWebhook);
router.post('/whatsapp', handleWebhookPayload);

module.exports = router;

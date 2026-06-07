const express = require('express');
const router = express.Router();
const {
  connectWhatsApp,
  getConnectionStatus,
  disconnectWhatsApp,
  testEmbeddedConnection,
} = require('../controllers/whatsappController');
const { protect } = require('../middleware/authMiddleware');

// Protect all routes
router.use(protect);

router.post('/connect', connectWhatsApp);
router.get('/status', getConnectionStatus);
router.delete('/disconnect', disconnectWhatsApp);
router.post('/test-embedded', testEmbeddedConnection);

module.exports = router;

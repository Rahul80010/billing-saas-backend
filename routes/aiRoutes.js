const express = require('express');
const router = express.Router();
const { chatWithAssistant } = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.post('/chat', chatWithAssistant);

module.exports = router;

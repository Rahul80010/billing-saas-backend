const express = require('express');
const router = express.Router();
const { 
  chatWithAssistant,
  getSessions,
  createSession,
  getSessionById,
  deleteSession
} = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Sessions CRUD
router.get('/sessions', getSessions);
router.post('/sessions', createSession);
router.get('/sessions/:id', getSessionById);
router.delete('/sessions/:id', deleteSession);

// Main AI Chat Loop
router.post('/chat', chatWithAssistant); // Backwards compatibility
router.post('/chat/:sessionId', chatWithAssistant);

module.exports = router;

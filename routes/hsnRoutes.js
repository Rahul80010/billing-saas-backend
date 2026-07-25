const express = require('express');
const router = express.Router();
const {
  searchHsn,
  autoSuggestHsn,
  getAllHsn,
  createHsn,
  updateHsn,
  deleteHsn,
} = require('../controllers/hsnController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/search', searchHsn);
router.get('/suggest', autoSuggestHsn);

router.route('/')
  .get(getAllHsn)
  .post(createHsn);

router.route('/:id')
  .put(updateHsn)
  .delete(deleteHsn);

module.exports = router;

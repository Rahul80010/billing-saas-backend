const express = require('express');
const router = express.Router();
const { uploadImage, deleteImage, migrateBase64Images } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

router.post('/image', protect, uploadImage);
router.post('/delete', protect, deleteImage);
router.post('/migrate', protect, migrateBase64Images);

module.exports = router;

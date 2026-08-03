const express = require('express');
const router = express.Router();
const { uploadImage, uploadImageFromUrl, deleteImage, getStorageStats, migrateBase64Images } = require('../controllers/uploadController');
const { protect } = require('../middleware/authMiddleware');

router.post('/image', protect, uploadImage);
router.post('/image-url', protect, uploadImageFromUrl);
router.post('/delete', protect, deleteImage);
router.get('/stats', protect, getStorageStats);
router.post('/migrate', protect, migrateBase64Images);

module.exports = router;

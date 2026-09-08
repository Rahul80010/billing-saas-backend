const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
  getGalleryAssets,
  getGalleryCategories,
  getGalleryAssetById,
  recordAssetUsage,
  uploadGalleryAsset,
  updateGalleryAsset,
  toggleAssetStatus,
  deleteGalleryAsset,
  getGalleryStats,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/galleryController');

// Merchant & General Authenticated User Routes
router.get('/', protect, getGalleryAssets);
router.get('/categories', protect, getGalleryCategories);
router.get('/:id', protect, getGalleryAssetById);
router.post('/usage/:id', protect, recordAssetUsage);

// Admin-Only Routes
router.get('/admin/stats', protect, admin, getGalleryStats);
router.post('/admin/upload', protect, admin, uploadGalleryAsset);
router.post('/admin', protect, admin, uploadGalleryAsset);
router.put('/admin/:id', protect, admin, updateGalleryAsset);
router.patch('/admin/:id/status', protect, admin, toggleAssetStatus);
router.delete('/admin/:id', protect, admin, deleteGalleryAsset);

// Admin Category Management Routes
router.post('/admin/categories', protect, admin, createCategory);
router.put('/admin/categories/:id', protect, admin, updateCategory);
router.delete('/admin/categories/:id', protect, admin, deleteCategory);

module.exports = router;

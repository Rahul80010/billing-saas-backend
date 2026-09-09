const express = require('express');
const router = express.Router();
const { protect, optionalProtect, admin } = require('../middleware/authMiddleware');
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

// Admin-Only Routes (Must be declared before /:id)
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

// Merchant, Mobile App & Public Gallery Browse Routes (Accessible with or without token)
router.get('/', optionalProtect, getGalleryAssets);
router.get('/categories', optionalProtect, getGalleryCategories);
router.post('/usage/:id', optionalProtect, recordAssetUsage);
router.get('/:id', optionalProtect, getGalleryAssetById);

module.exports = router;

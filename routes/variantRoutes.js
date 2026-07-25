const express = require('express');
const router = express.Router();
const {
  getVariants,
  getBulkVariants,
  getVariantByBarcode,
  createVariant,
  updateVariant,
  deleteVariant,
} = require('../controllers/variantController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

// Bulk fetch for product list page
router.get('/bulk', getBulkVariants);

// Barcode lookup for billing scanner
router.get('/barcode/:code', getVariantByBarcode);

// Standard CRUD
router.route('/').get(getVariants).post(createVariant);
router.route('/:id').put(updateVariant).delete(deleteVariant);

module.exports = router;

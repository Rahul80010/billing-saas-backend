const express = require('express');
const router = express.Router();
const {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
} = require('../controllers/productController');
const { protect } = require('../middleware/authMiddleware');

// Protect all routes
router.use(protect);

router.route('/').get(getProducts).post(createProduct);
router.post('/bulk-delete', bulkDeleteProducts);
router.route('/:id').put(updateProduct).delete(deleteProduct);

module.exports = router;

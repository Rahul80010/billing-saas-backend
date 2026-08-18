const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getPublicStore,
  placePublicOrder,
  trackPublicOrder,
  getStoreSettings,
  updateStoreSettings,
  regenerateStoreToken,
  getStockOrders,
  updateStockOrderStatus,
  createBillFromStockOrder,
} = require('../controllers/stockSharingController');

// ==========================================
// PUBLIC CUSTOMER STORE ROUTES (No Auth Required)
// ==========================================
router.get('/public/store/:storeToken', getPublicStore);
router.post('/public/store/:storeToken/order', placePublicOrder);
router.get('/public/store/:storeToken/track/:orderToken', trackPublicOrder);

// ==========================================
// TENANT PROTECTED ROUTES (Auth Required)
// ==========================================
router.use(protect);

router.get('/settings', getStoreSettings);
router.put('/settings', updateStoreSettings);
router.post('/regenerate-token', regenerateStoreToken);

router.get('/orders', getStockOrders);
router.put('/orders/:id/status', updateStockOrderStatus);
router.post('/orders/:id/create-bill', createBillFromStockOrder);

module.exports = router;

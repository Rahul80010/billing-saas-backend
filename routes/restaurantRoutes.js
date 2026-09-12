const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const restaurantController = require('../controllers/restaurantController');

// ==========================================
// ADMIN/MANAGER ROUTES (Requires Auth)
// ==========================================

router.post('/tables', protect, restaurantController.createTable);
router.post('/rooms/bulk', protect, restaurantController.bulkCreateRooms);
router.get('/tables', protect, restaurantController.getTables);
router.put('/tables/:id', protect, restaurantController.updateTable);
router.delete('/tables/:id', protect, restaurantController.deleteTable);

// ==========================================
// KITCHEN & BILLING ROUTES (Requires Auth)
// ==========================================

router.post('/orders', protect, restaurantController.placeOrder);
router.get('/orders', protect, restaurantController.getActiveOrders);
router.get('/orders/active', protect, restaurantController.getActiveOrders);
router.put('/orders/:id/status', protect, restaurantController.updateOrderStatus);

// Waiter Call Requests
router.get('/waiter-requests', protect, restaurantController.getPendingWaiterRequests);
router.put('/waiter-requests/resolve-all', protect, restaurantController.resolveAllWaiterRequests);
router.put('/waiter-requests/:id/resolve', protect, restaurantController.resolveWaiterRequest);

// ==========================================
// PUBLIC CUSTOMER ROUTES (No Auth Required)
// ==========================================

// Used by Customer scanning QR
router.get('/public/menu/:tenantId/:tableId', restaurantController.getPublicMenu);
router.post('/public/order', restaurantController.placeOrder);
router.get('/public/order/:orderId', restaurantController.getOrderStatus);
router.post('/public/waiter-request', restaurantController.createWaiterRequest);
router.get('/public/customer-lookup/:tenantId/:phone', restaurantController.lookupCustomerByPhone);

module.exports = router;

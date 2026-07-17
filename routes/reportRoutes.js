const express = require('express');
const router = express.Router();
const {
  getReportDashboard,
  getSalesReport,
  getPurchaseReport,
  getExpenses,
  logExpense,
  addSupplier,
  getSuppliers,
  logPurchase,
  generateAiInsights
} = require('../controllers/reportController');
const { protect } = require('../middleware/authMiddleware');

router.use(protect);

router.get('/dashboard', getReportDashboard);
router.get('/sales', getSalesReport);
router.get('/purchases', getPurchaseReport);
router.get('/expenses', getExpenses);
router.post('/expense', logExpense);
router.post('/supplier', addSupplier);
router.get('/suppliers', getSuppliers);
router.post('/purchase', logPurchase);
router.get('/ai-insights', generateAiInsights);

module.exports = router;

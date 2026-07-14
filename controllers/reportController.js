const Bill = require('../models/Bill');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const axios = require('axios');

// Helper function to calculate date bounds based on timeframe
const getDateBounds = (timeframe, customStart, customEnd) => {
  const now = new Date();
  let start = new Date(2000, 0, 1); // default fallback: all time
  let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (timeframe === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  } else if (timeframe === 'yesterday') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0, 0);
    end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
  } else if (timeframe === 'weekly') {
    const monday = new Date(now);
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    monday.setDate(diff);
    start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0, 0);
  } else if (timeframe === 'monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  } else if (timeframe === 'yearly') {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  } else if (timeframe === 'custom' && customStart && customEnd) {
    const [sYr, sMon, sDay] = customStart.split('-').map(Number);
    const [eYr, eMon, eDay] = customEnd.split('-').map(Number);
    start = new Date(sYr, sMon - 1, sDay, 0, 0, 0, 0);
    end = new Date(eYr, eMon - 1, eDay, 23, 59, 59, 999);
  }
  return { start, end };
};

// @desc    Get reports dashboard data (KPI Cards & Charts datasets)
// @route   GET /api/reports/dashboard
// @access  Private
const getReportDashboard = async (req, res) => {
  try {
    const userId = req.user._id;
    const { timeframe, startDate, endDate } = req.query;
    
    const { start, end } = getDateBounds(timeframe || 'monthly', startDate, endDate);

    // Query databases within timeframe bounds
    const bills = await Bill.find({ userId, createdAt: { $gte: start, $lte: end } });
    const purchases = await Purchase.find({ userId, purchaseDate: { $gte: start, $lte: end } });
    const expenses = await Expense.find({ userId, expenseDate: { $gte: start, $lte: end } });
    const products = await Product.find({ userId });
    const suppliers = await Supplier.find({ userId });

    // 1. KPI Calculations
    const totalSales = bills.reduce((sum, b) => sum + (b.total || 0), 0);
    const totalPurchase = purchases.reduce((sum, p) => sum + (p.total || 0), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);

    // Calculate Total Purchase Cost of items sold to find exact profit margins
    let totalSalesBuyingCost = 0;
    bills.forEach(b => {
      if (b.items) {
        b.items.forEach(item => {
          totalSalesBuyingCost += (item.buyingCost || 0) * (item.quantity || 0);
        });
      }
    });

    const netProfit = totalSales - totalPurchase - totalExpenses;
    
    // Unique customers count
    const uniqueCustomers = new Set(bills.map(b => b.customerPhone).filter(Boolean));
    const totalCustomersCount = uniqueCustomers.size;
    const totalProductsCount = products.length;
    const totalBillsCount = bills.length;

    // Credit dues outstanding
    const pendingCredit = bills.reduce((sum, b) => sum + (b.remainingAmount || 0), 0);

    // GST splits
    let gstCollected = 0;
    bills.forEach(b => {
      if (b.items) {
        b.items.forEach(item => {
          gstCollected += (item.price * item.quantity) * ((item.gst || 0) / 100);
        });
      }
    });

    let gstPaid = 0;
    purchases.forEach(p => {
      if (p.items) {
        p.items.forEach(item => {
          gstPaid += (item.price * item.quantity) * ((item.gst || 0) / 100);
        });
      }
    });

    // Monthly revenue trend (last 12 months, independent of active filter timeframe)
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    const billsForTrend = await Bill.find({ userId, createdAt: { $gte: twelveMonthsAgo } });

    const monthlyRevenueMap = {};
    billsForTrend.forEach(b => {
      const date = new Date(b.createdAt);
      const key = `${date.toLocaleString('default', { month: 'short' })} ${date.getFullYear()}`;
      monthlyRevenueMap[key] = (monthlyRevenueMap[key] || 0) + (b.total || 0);
    });

    const monthlyRevenueTrend = Object.entries(monthlyRevenueMap)
      .map(([month, revenue]) => ({ month, revenue }))
      .slice(-12);

    // Inventory Value calculations
    const totalInventoryValue = products.reduce((sum, p) => sum + ((p.stock || 0) * (p.price || 0)), 0);

    // 2. Charts Datasets
    // Payment Methods distribution
    const paymentMethods = { Cash: 0, UPI: 0, Card: 0, Credit: 0 };
    bills.forEach(b => {
      if (b.paymentType === 'Credit') {
        paymentMethods.Credit += b.total || 0;
      } else {
        paymentMethods.UPI += b.total || 0; // Defaulting to UPI/Cash mix
      }
    });

    // Expenses Category Breakdown
    const expenseBreakdown = {};
    expenses.forEach(e => {
      expenseBreakdown[e.category] = (expenseBreakdown[e.category] || 0) + e.amount;
    });

    // Stock Valuations categories
    const stockStatus = { inStock: 0, lowStock: 0, outOfStock: 0 };
    products.forEach(p => {
      if (p.stock <= 0) stockStatus.outOfStock++;
      else if (p.stock <= 5) stockStatus.lowStock++;
      else stockStatus.inStock++;
    });

    // Top customers LTV list
    const customerLtvMap = {};
    bills.forEach(b => {
      if (b.customerPhone) {
        const key = `${b.customerName} (${b.customerPhone})`;
        customerLtvMap[key] = (customerLtvMap[key] || 0) + b.total;
      }
    });

    const topCustomers = Object.entries(customerLtvMap)
      .map(([name, ltv]) => ({ name, ltv }))
      .sort((a, b) => b.ltv - a.ltv)
      .slice(0, 5);

    res.json({
      kpis: {
        totalSales,
        totalPurchase,
        netProfit,
        totalCustomers: totalCustomersCount,
        totalProducts: totalProductsCount,
        totalBills: totalBillsCount,
        pendingCredit,
        gstCollected,
        gstPaid,
        netGst: gstCollected - gstPaid,
        totalExpenses,
        totalInventoryValue
      },
      charts: {
        monthlyRevenue: monthlyRevenueTrend,
        paymentMethods: Object.entries(paymentMethods).map(([name, value]) => ({ name, value })),
        expenseCategories: Object.entries(expenseBreakdown).map(([category, amount]) => ({ name: category, value: amount })),
        stockStatus,
        topCustomers
      }
    });
  } catch (error) {
    console.error('Failed to compile reports dashboard:', error);
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get detailed sales report (filtering & date ranges)
// @route   GET /api/reports/sales
// @access  Private
const getSalesReport = async (req, res) => {
  try {
    const userId = req.user._id;
    const { timeframe, startDate, endDate, paymentMode, status, search } = req.query;

    const { start, end } = getDateBounds(timeframe || 'monthly', startDate, endDate);

    let filter = { userId, createdAt: { $gte: start, $lte: end } };

    if (paymentMode && paymentMode !== 'All') {
      filter.paymentType = paymentMode;
    }

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { customerName: { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } }
      ];
    }

    const bills = await Bill.find(filter).sort({ createdAt: -1 });

    // Metrics calculations
    const grossSales = bills.reduce((sum, b) => sum + b.total, 0);
    const pendingCredit = bills.reduce((sum, b) => sum + b.remainingAmount, 0);
    const netSales = grossSales - pendingCredit;
    const avgBill = bills.length > 0 ? (grossSales / bills.length) : 0;
    
    let gstCollected = 0;
    bills.forEach(b => {
      if (b.items) {
        b.items.forEach(item => {
          gstCollected += (item.price * item.quantity) * ((item.gst || 0) / 100);
        });
      }
    });

    res.json({
      metrics: {
        grossSales,
        netSales,
        avgBill,
        gstCollected,
        cancelledBills: 0,
        returnedBills: 0
      },
      invoices: bills
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get purchase reports
// @route   GET /api/reports/purchases
// @access  Private
const getPurchaseReport = async (req, res) => {
  try {
    const userId = req.user._id;
    const { timeframe, startDate, endDate } = req.query;

    const { start, end } = getDateBounds(timeframe || 'monthly', startDate, endDate);

    const purchases = await Purchase.find({ userId, purchaseDate: { $gte: start, $lte: end } }).sort({ purchaseDate: -1 });
    
    let gstPaid = 0;
    purchases.forEach(p => {
      if (p.items) {
        p.items.forEach(item => {
          gstPaid += (item.price * item.quantity) * ((item.gst || 0) / 100);
        });
      }
    });

    res.json({
      summary: {
        totalPurchase,
        pendingSupplierPayments,
        gstPaid
      },
      supplierPurchases,
      purchases
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Log a new expense manually
// @route   POST /api/reports/expense
// @access  Private
const logExpense = async (req, res) => {
  try {
    const { category, amount, note, date } = req.body;
    
    if (!category || !amount) {
      return res.status(400).json({ message: 'Category and Amount are required.' });
    }

    const newExpense = await Expense.create({
      userId: req.user._id,
      category,
      amount: Number(amount),
      note: note || '',
      expenseDate: date ? new Date(date) : new Date()
    });

    res.status(201).json(newExpense);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Add supplier details
// @route   POST /api/reports/supplier
// @access  Private
const addSupplier = async (req, res) => {
  try {
    const { name, phone, email, address } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: 'Supplier Name and Phone are required.' });
    }

    const newSupplier = await Supplier.create({
      userId: req.user._id,
      name,
      phone,
      email: email || '',
      address: address || '',
      outstandingBalance: 0
    });

    res.status(201).json(newSupplier);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get all suppliers list
// @route   GET /api/reports/suppliers
// @access  Private
const getSuppliers = async (req, res) => {
  try {
    const suppliers = await Supplier.find({ userId: req.user._id }).sort({ name: 1 });
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Log supplier purchase outflow
// @route   POST /api/reports/purchase
// @access  Private
const logPurchase = async (req, res) => {
  try {
    const { supplierId, items, total, paidAmount, remainingAmount, status, date } = req.body;

    if (!supplierId || !total) {
      return res.status(400).json({ message: 'Supplier ID and Total amount are required.' });
    }

    const supplier = await Supplier.findOne({ _id: supplierId, userId: req.user._id });
    if (!supplier) {
      return res.status(404).json({ message: 'Supplier not found' });
    }

    const newPurchase = await Purchase.create({
      userId: req.user._id,
      supplierId: supplier._id,
      supplierName: supplier.name,
      items: items || [],
      total: Number(total),
      paidAmount: Number(paidAmount || 0),
      remainingAmount: Number(remainingAmount || 0),
      status: status || 'paid',
      purchaseDate: date ? new Date(date) : new Date()
    });

    // Update supplier outstanding balance
    if (newPurchase.remainingAmount > 0) {
      supplier.outstandingBalance += newPurchase.remainingAmount;
      await supplier.save();
    }

    res.status(201).json(newPurchase);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Ask Mohuri AI to generate business insights
// @route   GET /api/reports/ai-insights
// @access  Private
const generateAiInsights = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const userId = req.user._id;

  try {
    // 1. Gather all store stats summaries
    const bills = await Bill.find({ userId });
    const purchases = await Purchase.find({ userId });
    const expenses = await Expense.find({ userId });
    const products = await Product.find({ userId });

    const totalSales = bills.reduce((sum, b) => sum + b.total, 0);
    const totalPurchase = purchases.reduce((sum, p) => sum + p.total, 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const pendingCredit = bills.reduce((sum, b) => sum + b.remainingAmount, 0);
    const lowStock = products.filter(p => p.stock <= 5).map(p => `${p.name} (${p.stock} left)`);

    const statsContext = {
      totalSales,
      totalPurchase,
      totalExpenses,
      pendingCredit,
      totalProductsCount: products.length,
      lowStockList: lowStock.slice(0, 5),
    };

    if (apiKey) {
      const prompt = `
You are the business analytics engine for Mohuri Billing SaaS.
Analyze the following merchant business stats and generate:
1. **Sales Insights**: Brief review of sales vs purchases.
2. **Inventory Suggestions**: Advice based on low stock list.
3. **Credit Recovery**: Strategies to recover pending credits (udhaar).
4. **Expense Control**: Brief suggestions to control operational expenses.

STATS:
- Total Sales: ₹${totalSales}
- Total Supplies Purchase: ₹${totalPurchase}
- Operating Expenses: ₹${totalExpenses}
- Outstanding Udhaar: ₹${pendingCredit}
- Low Stock Items: ${lowStock.join(', ')}

Please format your response in clean markdown bullet points. Speak like a professional MBA consultant. Keep it highly action-oriented.
`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const response = await axios.post(geminiUrl, {
        contents: [{ parts: [{ text: prompt }] }]
      });

      const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        return res.json({ insights: reply.trim() });
      }
    }

    // Fallback rule-based smart insights if Gemini key is missing
    const fallback = `### 🤖 Mohuri AI Automated Business Analytics

* **Sales Insights**: Your total sales of ₹${totalSales.toFixed(2)} compared to purchases of ₹${totalPurchase.toFixed(2)} indicates a gross inventory mark-up. Maintain pricing structures to protect margins.
* **Inventory Suggestions**: Low stock items detected: **${lowStock.slice(0, 3).join(', ') || 'None. Stock is healthy!'}**. Replenish these items immediately to prevent sales loss.
* **Credit Recovery**: You have ₹${pendingCredit.toFixed(2)} outstanding Udhaar dues. Settle payments by going to the **Credit dashboard** and triggering automated WhatsApp reminder alerts with UPI collection QR codes.
* **Expense Control**: Your current operating expenses total ₹${totalExpenses.toFixed(2)}. Review monthly internet, rent, and miscellaneous salaries to maximize net cash flows.`;

    res.json({ insights: fallback });

  } catch (error) {
    console.error('Failed to generate reports AI insights:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getReportDashboard,
  getSalesReport,
  getPurchaseReport,
  logExpense,
  addSupplier,
  getSuppliers,
  logPurchase,
  generateAiInsights
};

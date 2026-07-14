const Bill = require('../models/Bill');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const Expense = require('../models/Expense');
const axios = require('axios');

// Dynamic historical data seeder (2026-2030)
const seedHistoricalData = async (userId) => {
  try {
    console.log(`Seeding reports data for user: ${userId}`);

    // 1. Seed Suppliers
    const suppliersData = [
      { name: 'Apex Wholesalers', phone: '9876543201', email: 'sales@apex.com', address: 'Delhi, India', outstandingBalance: 4500 },
      { name: 'Bharat Distributors', phone: '9876543202', email: 'info@bharat.com', address: 'Mumbai, India', outstandingBalance: 12000 },
      { name: 'Global Supply Co', phone: '9876543203', email: 'supply@global.com', address: 'Kolkata, India', outstandingBalance: 0 },
      { name: 'Royal Goods Ltd', phone: '9876543204', email: 'orders@royalgoods.com', address: 'Bangalore, India', outstandingBalance: 8500 },
      { name: 'Metro Traders', phone: '9876543205', email: 'support@metro.com', address: 'Chennai, India', outstandingBalance: 0 }
    ];

    const seededSuppliers = [];
    for (const s of suppliersData) {
      let existing = await Supplier.findOne({ userId, name: s.name });
      if (!existing) {
        existing = await Supplier.create({ ...s, userId });
      }
      seededSuppliers.push(existing);
    }

    // 2. Seed Expenses (spread across 2026-2030)
    const expenseCategories = ['Electricity', 'Rent', 'Salary', 'Transport', 'Internet', 'Marketing', 'Miscellaneous'];
    const years = [2026, 2027, 2028, 2029, 2030];
    const months = Array.from({ length: 12 }, (_, i) => i);
    
    const expensesToCreate = [];
    for (const year of years) {
      for (const month of months) {
        // Rent (Monthly)
        expensesToCreate.push({
          userId,
          category: 'Rent',
          amount: 8000 + Math.floor(Math.random() * 1500),
          note: `Monthly office rent for ${month + 1}/${year}`,
          expenseDate: new Date(year, month, 5)
        });

        // Salary (Monthly)
        expensesToCreate.push({
          userId,
          category: 'Salary',
          amount: 15000 + Math.floor(Math.random() * 4000),
          note: `Staff salaries for ${month + 1}/${year}`,
          expenseDate: new Date(year, month, 7)
        });

        // Electricity (Every alternate month)
        if (month % 2 === 0) {
          expensesToCreate.push({
            userId,
            category: 'Electricity',
            amount: 1200 + Math.floor(Math.random() * 800),
            note: `Electricity bill for ${month + 1}/${year}`,
            expenseDate: new Date(year, month, 15)
          });
        }

        // Internet (Monthly)
        expensesToCreate.push({
          userId,
          category: 'Internet',
          amount: 800 + Math.floor(Math.random() * 200),
          note: `Wifi broadband renewal ${month + 1}/${year}`,
          expenseDate: new Date(year, month, 2)
        });

        // Add some random transport/marketing/misc expenses
        if (Math.random() > 0.4) {
          expensesToCreate.push({
            userId,
            category: 'Transport',
            amount: 400 + Math.floor(Math.random() * 1200),
            note: 'Goods courier charges',
            expenseDate: new Date(year, month, Math.floor(Math.random() * 25) + 1)
          });
        }
        if (Math.random() > 0.6) {
          expensesToCreate.push({
            userId,
            category: 'Marketing',
            amount: 1500 + Math.floor(Math.random() * 3000),
            note: 'Facebook ads campaign',
            expenseDate: new Date(year, month, Math.floor(Math.random() * 25) + 1)
          });
        }
      }
    }
    await Expense.insertMany(expensesToCreate);

    // 3. Seed Purchases
    const purchaseItemsOptions = [
      { name: 'Wireless Mouse', price: 250, gst: 18 },
      { name: 'Mechanical Keyboard', price: 1200, gst: 18 },
      { name: 'USB-C Charging Hub', price: 450, gst: 12 },
      { name: 'LED Desk Lamp', price: 650, gst: 12 },
      { name: 'Leather Notepad Holder', price: 180, gst: 5 },
      { name: 'Gel Pens Set', price: 40, gst: 5 }
    ];

    const purchasesToCreate = [];
    for (const year of years) {
      for (const month of months) {
        if (Math.random() > 0.3) { // 70% chance of purchase each month
          const supplier = seededSuppliers[Math.floor(Math.random() * seededSuppliers.length)];
          const itemCount = Math.floor(Math.random() * 3) + 1;
          const items = [];
          let total = 0;

          for (let i = 0; i < itemCount; i++) {
            const opt = purchaseItemsOptions[Math.floor(Math.random() * purchaseItemsOptions.length)];
            const qty = Math.floor(Math.random() * 15) + 5;
            items.push({
              productName: opt.name,
              price: opt.price,
              quantity: qty,
              gst: opt.gst
            });
            total += opt.price * qty;
          }

          const status = Math.random() > 0.3 ? 'paid' : 'pending';
          const remainingAmount = status === 'pending' ? total : 0;
          const paidAmount = status === 'paid' ? total : 0;

          purchasesToCreate.push({
            userId,
            supplierId: supplier._id,
            supplierName: supplier.name,
            items,
            total,
            paidAmount,
            remainingAmount,
            status,
            purchaseDate: new Date(year, month, Math.floor(Math.random() * 25) + 1)
          });
        }
      }
    }
    await Purchase.insertMany(purchasesToCreate);

    // 4. Seed bills/invoices if user has very few to ensure beautiful sales trend curves
    const userBillsCount = await Bill.countDocuments({ userId });
    if (userBillsCount < 10) {
      const customers = [
        { name: 'Ramesh Kumar', phone: '9001020304' },
        { name: 'Amit Singh', phone: '9111223344' },
        { name: 'Sita Sharma', phone: '9222334455' },
        { name: 'John Doe', phone: '9333445566' },
        { name: 'Pooja Patel', phone: '9444556677' }
      ];

      const billItemsOptions = [
        { productName: 'Wireless Mouse', price: 499, gst: 18, unit: 'pcs', buyingCost: 250 },
        { productName: 'Mechanical Keyboard', price: 2199, gst: 18, unit: 'pcs', buyingCost: 1200 },
        { productName: 'USB-C Charging Hub', price: 899, gst: 12, unit: 'pcs', buyingCost: 450 },
        { productName: 'LED Desk Lamp', price: 1299, gst: 12, unit: 'pcs', buyingCost: 650 },
        { productName: 'Leather Notepad Holder', price: 399, gst: 5, unit: 'pcs', buyingCost: 180 },
        { productName: 'Gel Pens Set', price: 99, gst: 5, unit: 'pcs', buyingCost: 40 }
      ];

      const billsToCreate = [];
      for (const year of years) {
        for (const month of months) {
          // Generate 1 to 3 sales per month
          const salesInMonth = Math.floor(Math.random() * 3) + 1;
          for (let s = 0; s < salesInMonth; s++) {
            const customer = customers[Math.floor(Math.random() * customers.length)];
            const itemCount = Math.floor(Math.random() * 3) + 1;
            const items = [];
            let total = 0;

            for (let i = 0; i < itemCount; i++) {
              const opt = billItemsOptions[Math.floor(Math.random() * billItemsOptions.length)];
              const qty = Math.floor(Math.random() * 3) + 1;
              items.push({
                productName: opt.productName,
                price: opt.price,
                quantity: qty,
                gst: opt.gst,
                unit: opt.unit,
                buyingCost: opt.buyingCost
              });
              total += opt.price * qty;
            }

            const paymentType = Math.random() > 0.3 ? 'Paid' : 'Credit';
            const remainingAmount = paymentType === 'Credit' ? total : 0;
            const paidAmount = paymentType === 'Paid' ? total : 0;
            const status = paymentType === 'Credit' ? 'pending' : 'paid';

            billsToCreate.push({
              userId,
              customerName: customer.name,
              customerPhone: customer.phone,
              items,
              total,
              paymentType,
              paidAmount,
              remainingAmount,
              status,
              dueDate: paymentType === 'Credit' ? new Date(year, month + 1, 15) : null,
              createdAt: new Date(year, month, Math.floor(Math.random() * 25) + 1)
            });
          }
        }
      }
      await Bill.insertMany(billsToCreate);
    }

    console.log('Reports data seeding completed successfully!');
  } catch (err) {
    console.error('Error seeding historical reports data:', err);
  }
};

// @desc    Get reports dashboard data (KPI Cards & Charts datasets)
// @route   GET /api/reports/dashboard
// @access  Private
const getReportDashboard = async (req, res) => {
  try {
    const userId = req.user._id;

    // Check if user has seeded reports data; if not, trigger seeding.
    const expenseCount = await Expense.countDocuments({ userId });
    if (expenseCount === 0) {
      await seedHistoricalData(userId);
    }

    // Query databases
    const bills = await Bill.find({ userId });
    const purchases = await Purchase.find({ userId });
    const expenses = await Expense.find({ userId });
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

    const netProfit = totalSales - totalSalesBuyingCost - totalExpenses;
    
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
          const itemBase = (item.price * item.quantity) / (1 + (item.gst || 0) / 100);
          gstCollected += (item.price * item.quantity) - itemBase;
        });
      }
    });

    let gstPaid = 0;
    purchases.forEach(p => {
      if (p.items) {
        p.items.forEach(item => {
          const itemBase = (item.price * item.quantity) / (1 + (item.gst || 0) / 100);
          gstPaid += (item.price * item.quantity) - itemBase;
        });
      }
    });

    // Monthly revenue trend (last 12 months)
    const monthlyRevenueMap = {};
    bills.forEach(b => {
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
    const { startDate, endDate, paymentMode, status, search } = req.query;

    let filter = { userId };

    if (startDate && endDate) {
      filter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

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
          const itemBase = (item.price * item.quantity) / (1 + (item.gst || 0) / 100);
          gstCollected += (item.price * item.quantity) - itemBase;
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
    const purchases = await Purchase.find({ userId }).sort({ purchaseDate: -1 });
    
    const totalPurchase = purchases.reduce((sum, p) => sum + p.total, 0);
    const pendingSupplierPayments = purchases.reduce((sum, p) => sum + p.remainingAmount, 0);

    // Supplier purchases summaries
    const supplierMap = {};
    purchases.forEach(p => {
      supplierMap[p.supplierName] = (supplierMap[p.supplierName] || 0) + p.total;
    });

    const supplierPurchases = Object.entries(supplierMap).map(([name, total]) => ({ name, total }));

    res.json({
      summary: {
        totalPurchase,
        pendingSupplierPayments,
        gstPaid: totalPurchase * 0.18 // Approximate GST
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

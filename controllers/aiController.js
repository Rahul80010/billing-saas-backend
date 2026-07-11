const axios = require('axios');

const Product = require('../models/Product');
const Bill = require('../models/Bill');

// Helper to query and calculate store statistics from MongoDB
const getStoreStats = async (userId) => {
  try {
    const products = await Product.find({ userId });
    const bills = await Bill.find({ userId });

    // Sales calculations
    const totalSales = bills.reduce((sum, b) => sum + (b.total || 0), 0);
    const totalCredit = bills.reduce((sum, b) => sum + (b.remainingAmount || 0), 0);

    // Today's sales
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayBills = bills.filter(b => new Date(b.createdAt) >= today);
    const todaySales = todayBills.reduce((sum, b) => sum + (b.total || 0), 0);

    // Low stock items
    const lowStock = products.filter(p => p.stock !== undefined && p.stock <= 5).map(p => `${p.name} (${p.stock} left)`);

    // Credit by customer
    const customerCreditMap = {};
    bills.forEach(b => {
      if (b.remainingAmount > 0 && b.customerPhone) {
        const key = `${b.customerName || 'Unknown'} (${b.customerPhone})`;
        customerCreditMap[key] = (customerCreditMap[key] || 0) + b.remainingAmount;
      }
    });

    const topDebtors = Object.entries(customerCreditMap)
      .map(([customer, amount]) => ({ customer, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    // Product sales quantities
    const productSalesMap = {};
    bills.forEach(b => {
      if (Array.isArray(b.items)) {
        b.items.forEach(item => {
          const name = item.productName || 'Unknown';
          productSalesMap[name] = (productSalesMap[name] || 0) + (item.quantity || 0);
        });
      }
    });

    const topProducts = Object.entries(productSalesMap)
      .map(([product, quantity]) => ({ product, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    return {
      totalProductsCount: products.length,
      totalBillsCount: bills.length,
      totalSales,
      todaySales,
      totalCredit,
      lowStockList: lowStock.slice(0, 8),
      topDebtorsList: topDebtors,
      topProductsList: topProducts,
      productsSummary: products.map(p => ({ name: p.name, price: p.price, stock: p.stock, barcode: p.barcode || 'N/A' }))
    };
  } catch (err) {
    console.error('Failed to calculate store stats:', err);
    return {
      totalProductsCount: 0,
      totalBillsCount: 0,
      totalSales: 0,
      todaySales: 0,
      totalCredit: 0,
      lowStockList: [],
      topDebtorsList: [],
      topProductsList: [],
      productsSummary: []
    };
  }
};

// @desc    Chat with Mohuri AI Assistant product expert (Live DB Resolver)
// @route   POST /api/ai/chat
// @access  Private
const chatWithAssistant = async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ message: 'Message is required' });
  }

  const query = message.toLowerCase().trim();
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    const stats = await getStoreStats(req.user._id);

    // If Gemini API Key is missing, fall back to smart local JS calculations on MongoDB records
    if (!apiKey) {
      let reply = '';
      if (
        query.includes('sale') || 
        query.includes('today') || 
        query.includes('kitna kamaya') || 
        query.includes('selling') || 
        query.includes('earn') ||
        query.includes('dhandha')
      ) {
        reply = `📊 **Sales Statistics:**\n\n` +
                `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
                `- **Total Sales (All Time)**: ₹${stats.totalSales.toFixed(2)}\n` +
                `- **Top-Selling Items**: ${stats.topProductsList.map(p => `${p.product} (${p.quantity} sold)`).join(', ') || 'No sales recorded yet.'}`;
      } else if (
        query.includes('udhaar') || 
        query.includes('credit') || 
        query.includes('debt') || 
        query.includes('due') || 
        query.includes('baaki') ||
        query.includes('payment')
      ) {
        reply = `💸 **Credit & Udhaar Ledger Dues:**\n\n` +
                `- **Total Outstanding Dues**: ₹${stats.totalCredit.toFixed(2)}\n` +
                `- **Top Customer Dues**:\n` +
                (stats.topDebtorsList.map(d => `  * ${d.customer}: ₹${d.amount.toFixed(2)}`).join('\n') || '  * No outstanding credit dues.');
      } else if (
        query.includes('stock') || 
        query.includes('inventory') || 
        query.includes('product') || 
        query.includes('item')
      ) {
        reply = `📦 **Inventory Stock Summary:**\n\n` +
                `- **Total Products in Catalog**: ${stats.totalProductsCount} items\n` +
                `- **Low Stock Items**: ${stats.lowStockList.join(', ') || 'All items have healthy stock levels!'}`;
      } else {
        reply = `👋 Hello! Here is your live database summary:\n\n` +
                `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
                `- **Total Outstanding Credit**: ₹${stats.totalCredit.toFixed(2)}\n` +
                `- **Total Products**: ${stats.totalProductsCount} items\n\n` +
                `How can I help you manage your store today?`;
      }
      return res.json({ reply });
    }

    // Call Gemini with Live Store Database Summary injected as Context
    const axios = require('axios');
    const prompt = `
You are the official Mohuri AI Assistant, a friendly and professional product expert & business analyst for Mohuri - a premium SaaS billing & invoicing platform built by Detalogy.

YOUR PERSONALITY:
- Speak like a friendly customer support executive.
- Keep your answers short, clear, and easy to understand (usually 2-4 sentences max).
- You can understand and respond in English, Hindi, or Hinglish (mixed Hindi-English), matching the language the user speaks to you.

LIVE STORE DATABASE SUMMARY (Current merchant stats from MongoDB):
- Merchant Name: ${req.user.name}
- Store Business Name: ${req.user.businessName || req.user.name || 'MOHURI'}
- Total Sales to date: ₹${stats.totalSales.toFixed(2)}
- Today's Sales: ₹${stats.todaySales.toFixed(2)}
- Total Outstanding Credit (Udhaar): ₹${stats.totalCredit.toFixed(2)}
- Total Products in Catalog: ${stats.totalProductsCount}
- Total Bills Issued: ${stats.totalBillsCount}
- Top Debtors (Outstanding Credit): ${JSON.stringify(stats.topDebtorsList)}
- Top Selling Products (by quantity): ${JSON.stringify(stats.topProductsList)}
- Low Stock Products: ${JSON.stringify(stats.lowStockList)}
- Full Product Catalog (Name, Price, Stock, Barcode): ${JSON.stringify(stats.productsSummary.slice(0, 30))}

MOHURI SOFTWARE HELP DOCUMENTATION:
- Billing: Billing page lets you select from inventory or manual inputs, select Paid/Credit, use voice activation, scan barcodes, print PDF invoice and share on WhatsApp.
- Products: Products page lets you manage catalog name, price, buying cost, stock, unit, EAN barcodes (using camera scan or scan machine gun).
- Credit Ledger: Credit page monitors outstanding dues, record customer payments, and send WhatsApp reminders with UPI QR codes.
- CRM Campaigns: Settings page links WhatsApp API, CRM page sends bulk festival offers / campaign templates to customers.
- Offline Mode: Works offline via browser IndexedDB caching, queues pending bills, synchronizes using "Sync Now" button when online.

Your task is to answer the user's question. If they ask about their store stats (like sales, credit, top products, stock), use the LIVE STORE DATABASE SUMMARY above to answer accurately! If they ask how to use a feature, use the help documentation.

USER QUESTION: "${message}"
YOUR ANSWER:
`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    const response = await axios.post(geminiUrl, {
      contents: [{
        parts: [{ text: prompt }]
      }]
    });

    const reply = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      return res.status(500).json({ message: 'Failed to retrieve response from Gemini AI' });
    }

    res.json({ reply: reply.trim() });
  } catch (error) {
    console.error('Error in chatWithAssistant:', error.message);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  chatWithAssistant,
};

module.exports = {
  chatWithAssistant,
};

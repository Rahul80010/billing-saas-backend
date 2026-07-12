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

// @desc    Chat with Mohuri AI Assistant product expert (Live DB + Trained Knowledge base)
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
        query.includes('dhandha') ||
        query.includes('history') ||
        query.includes('invoice') ||
        query.includes('bill') ||
        query.includes('create') ||
        query.includes('karo') ||
        query.includes('banaye')
      ) {
        reply = `📊 **Sales & Billing Statistics (Live Local DB Calculation):**\n\n` +
                `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
                `- **Total Sales (All Time)**: ₹${stats.totalSales.toFixed(2)}\n` +
                `- **Total Bills Issued**: ${stats.totalBillsCount} bills\n` +
                `- **Top-Selling Items**: ${stats.topProductsList.map(p => `${p.product} (${p.quantity} sold)`).join(', ') || 'No sales recorded yet.'}\n\n` +
                `*Guide*: Go to the **Billing** page in the sidebar. You can search products, add items manually, scan barcodes (via USB gun or mobile camera), or click the pulsing microphone icon to streams voice items (e.g. *"2 kg sugar aur 1 packet milk"*). Select **Paid** or **Credit/Udhaar** and click **Generate Bill**!`;
      } else if (
        query.includes('udhaar') || 
        query.includes('credit') || 
        query.includes('debt') || 
        query.includes('due') || 
        query.includes('baaki') ||
        query.includes('payment') ||
        query.includes('pay') ||
        query.includes('remind') ||
        query.includes('reminder') ||
        query.includes('due') ||
        query.includes('date') ||
        query.includes('qr') ||
        query.includes('upi')
      ) {
        reply = `💸 **Credit & Udhaar Ledger (Live Local DB Calculation):**\n\n` +
                `- **Total Outstanding Dues**: ₹${stats.totalCredit.toFixed(2)}\n` +
                `- **Top Debtors Outstanding**:\n` +
                (stats.topDebtorsList.map(d => `  * ${d.customer}: ₹${d.amount.toFixed(2)}`).join('\n') || '  * No outstanding credit dues.') + `\n\n` +
                `*Guide*: Settle balance on the **Credit** dashboard. You can send automated WhatsApp reminder messages containing secure UPI payment links and dynamic collections QR codes by setting up your **UPI ID** under the **Settings** page!`;
      } else if (
        query.includes('stock') || 
        query.includes('inventory') || 
        query.includes('product') || 
        query.includes('item') ||
        query.includes('add product') ||
        query.includes('create product')
      ) {
        reply = `📦 **Inventory & Products Catalog (Live Local DB Calculation):**\n\n` +
                `- **Total Products in Catalog**: ${stats.totalProductsCount} items\n` +
                `- **Low Stock Items**: ${stats.lowStockList.join(', ') || 'All items have healthy stock levels!'}\n\n` +
                `*Guide*: Go to the **Products** page to add items with Name, Price, Buying Cost (for profit calculations), GST %, and EAN Barcodes (scan using gun or camera).`;
      } else if (
        query.includes('whatsapp') || 
        query.includes('crm') || 
        query.includes('campaign') || 
        query.includes('marketing') || 
        query.includes('offer') || 
        query.includes('bulk') ||
        query.includes('connect') ||
        query.includes('template')
      ) {
        reply = `💬 **WhatsApp CRM & Campaigns Guide:**\n\n` +
                `- **Connect WhatsApp**: Go to **Settings** -> WhatsApp Settings to scan the QR/API connection.\n` +
                `- **Bulk Campaigns**: Go to **CRM** in the sidebar. Compose your offer message, select your audience filters (all, active, or debtors), and dispatch bulk marketing messages directly via WhatsApp!\n` +
                `- **Reminder Templates**: Customize your billing messages templates in settings using dynamic variables like {customerName}, {remainingAmount}, and {invoiceNo}.`;
      } else if (
        query.includes('offline') || 
        query.includes('internet') || 
        query.includes('connection') || 
        query.includes('sync')
      ) {
        reply = `🔌 **Offline Mode & Caching:**\n\n` +
                `- **Offline Billing**: Mohuri caches your product catalog in IndexedDB. If internet is down, checkout still works!\n` +
                `- **Orange Banner**: Lists pending unsynced offline sales on the screen.\n` +
                `- **Cloud Sync**: Settle connection and tap **Sync Now** to upload all local cash bills to the database.`;
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

MOHURI DETAILED SOFTWARE TRAINING DOCUMENTATION:
1. Billing / Create Invoice:
   - Go to the "Billing" page in the navigation bar.
   - Choose from "Choose from Inventory" to select saved products or click "Add Manually" for a custom one-off item.
   - Select the payment type: "Paid" or "Credit (Udhaar)".
   - To add items using Voice, click the "Voice Assistant" button (pulsing mic) and speak (e.g. "2 kg sugar aur 1 packet milk").
   - To scan barcodes, scan using your barcode gun anywhere on the screen, or click the "Camera" scan icon next to the scan input to scan with your phone camera.
   - Click "Generate Bill" to complete. After generation, you can print/open PDF invoice and share it directly on WhatsApp.
2. Products / Inventory:
   - Go to "Products" to create, view, edit or delete products.
   - You can specify product Name, Price, optional Buying Cost, GST Rate (%), Stock Quantity, Unit (pcs/kg), and a Barcode.
   - You can scan the barcode using a scanner machine gun directly or click the Camera button to scan a barcode using your device camera.
3. Customers:
   - Go to "Customers" to see the list of your customers, their total outstanding balance, and transaction history.
4. Credit / Udhaar Management:
   - When creating a bill, select "Credit (Udhaar)". Set a "Reminder Date" and enter how much they paid today (default 0).
   - The remaining amount will show up in the customer's ledger.
   - On the "Credit" dashboard, you can record customer payments (partial or full settlement) and send WhatsApp payment reminders.
   - If you have configured a UPI ID in settings, a WhatsApp reminder message will automatically include a secure UPI payment link and QR code.
5. WhatsApp Integration & CRM (WhatsApp Marketing):
   - Go to "Settings" and connect your WhatsApp Business API / WhatsApp QR.
   - Go to "CRM" to compose and dispatch bulk marketing campaigns and offers directly to your customer base.
   - You can customize the WhatsApp Reminder template in Settings (e.g., customize placeholders like {customerName}, {remainingAmount}, {invoiceNo}, {reminderDate}).
6. Invoice & PDF:
   - After generating any invoice, you can download it as a tax-compliant PDF.
   - Support A4, A5, and 3-inch thermal printer roll configurations.
7. Offline Billing Support:
   - Mohuri works offline! If your internet disconnects, you can still search products, add items, and save bills locally.
   - Stored offline bills will show in an orange banner on the screen.
   - When connection returns, click "Sync Now" to synchronize all offline bills with the live server database.
8. Settings & Profile:
   - Go to "Settings" to update business name, address, phone number, UPI ID for QR collections, and WhatsApp integration templates.
9. Reports:
   - View sales, profit, and business reports inside the dashboard.

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

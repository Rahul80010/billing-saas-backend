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
      // --- HELP / SOFTWARE GUIDE QUERIES ---

      // 1. Billing / Create Invoice Guide
      if (
        (query.includes('bill') || query.includes('invoice') || query.includes('billing') || query.includes('receipt')) &&
        (query.includes('how') || query.includes('kaise') || query.includes('create') || query.includes('banaye') || query.includes('karo') || query.includes('print'))
      ) {
        return res.json({
          reply: `📄 **Billing & Invoice Creation Guide:**\n\n` +
                 `1. Go to the **Billing** page from the sidebar.\n` +
                 `2. Choose from **Inventory** to select saved products or use **Add Manually** for custom items.\n` +
                 `3. **Fast Barcode Scan**: Scan with a USB gun anywhere on the screen, or click the **Camera icon** to scan EAN/UPC barcodes using your phone camera.\n` +
                 `4. **Voice commands**: Tap the pulsing microphone button and speak (e.g., *"2 kg sugar aur 1 packet milk"*).\n` +
                 `5. Select **Paid** or **Credit (Udhaar)** payment method and click **Generate Bill** to save, print (A4, A5, thermal roll size), and share the PDF invoice directly on WhatsApp!`
        });
      }

      // 2. Add / Manage Product Guide
      if (
        (query.includes('product') || query.includes('item') || query.includes('inventory')) &&
        (query.includes('add') || query.includes('create') || query.includes('how') || query.includes('kaise') || query.includes('nayan') || query.includes('edit'))
      ) {
        return res.json({
          reply: `📦 **Product & Inventory Management Guide:**\n\n` +
                 `1. Go to the **Products** page from the sidebar.\n` +
                 `2. Click the **Add Product** form field.\n` +
                 `3. Enter the Product Name, Price (selling rate), GST (%), Stock, and Buying Cost (to calculate profit margins).\n" +
                 `4. **Barcode setup**: Scan EAN barcodes using your camera scanner or machine gun directly in the form input field.\n` +
                 `5. Click **Save** to index the product, making it searchable instantly on the checkout page!`
        });
      }

      // 3. Add Customer Guide
      if (
        query.includes('customer') &&
        (query.includes('add') || query.includes('create') || query.includes('how') || query.includes('kaise') || query.includes('new'))
      ) {
        return res.json({
          reply: `👤 **Customer Management Guide:**\n\n` +
                 `1. Go to the **Customers** page from the sidebar.\n` +
                 `2. You can view all registered customer names, phone numbers, registration dates, and outstanding credit balances.\n` +
                 `3. A new customer is automatically created and saved whenever you generate a bill under their name and phone number on the checkout page!`
        });
      }

      // 4. Send Offers / CRM Guide
      if (
        query.includes('offer') || 
        query.includes('crm') || 
        query.includes('campaign') || 
        query.includes('marketing') || 
        query.includes('bulk')
      ) {
        return res.json({
          reply: `💬 **WhatsApp CRM & Marketing Offers Guide:**\n\n` +
                 `1. **Connect Account**: Go to **Settings** and scan the WhatsApp QR/API connection.\n` +
                 `2. **Send Offers**: Go to the **CRM** page in the sidebar.\n` +
                 `3. Compose your promotion/marketing offer message text.\n` +
                 `4. Select target audience filters (e.g. active customer base, or debtors list).\n` +
                 `5. Click **Send** to dispatch bulk marketing messages directly via WhatsApp!`
        });
      }

      // 5. Udhaar / Credit Guide
      if (
        query.includes('udhaar') || 
        query.includes('credit')
      ) {
        // If it's not a stats query (e.g., not asking how much or who owes balance), return the usage guide
        if (!(query.includes('how much') || query.includes('kitna') || query.includes('check') || query.includes('kiska') || query.includes('bal') || query.includes('list'))) {
          return res.json({
            reply: `💸 **How Credit (Udhaar) Management Works:**\n\n` +
                   `1. **Record Udhaar**: During checkout, select payment method **Credit (Udhaar)**, set a Reminder Date, and specify any downpayment amount.\n` +
                   `2. **Automated Reminders**: Open the **Credit** dashboard to view outstanding dues, log partial settlements, and click **Send WhatsApp Reminder**.\n` +
                   `3. **UPI Payment Link**: Entering your UPI ID in **Settings** automatically appends a secure payment link and collection QR code to all WhatsApp reminder messages!`
          });
        }
      }

      // 6. Support Contact Info & Helpline details
      if (
        query.includes('contact') || 
        query.includes('number') || 
        query.includes('phone') || 
        query.includes('call') || 
        query.includes('helpline') || 
        query.includes('support') ||
        query.includes('email') ||
        query.includes('address') ||
        query.includes('helpdesk') ||
        query.includes('developer') ||
        query.includes('detalogy')
      ) {
        return res.json({
          reply: `📞 **Mohuri Support Desk (Detalogy):**\n\n` +
                 `- **WhatsApp & Phone Support**: +91 76799 37056\n` +
                 `- **Support Email**: support@detalogy.com\n` +
                 `- **Working Hours**: Monday to Saturday, 9:00 AM - 7:00 PM IST\n\n` +
                 `Please contact us if you need help, have queries, or want customized updates!`
        });
      }

      // 7. Offline mode guide
      if (query.includes('offline') || query.includes('internet') || query.includes('indexeddb') || query.includes('sync')) {
        return res.json({
          reply: `🔌 **Offline Mode & Cloud Sync Guide:**\n\n` +
                 `- Mohuri stores products locally in browser IndexedDB. If internet is down, you can still query inventory and save bills.\n` +
                 `- Unsynced invoices will display in an orange banner on the screen.\n` +
                 `- When you settle connection, click **Sync Now** to upload cached sales to the server.`
        });
      }

      // --- STATS / DATABASE DATA QUERIES ---

      // 8. Sales Stats
      if (
        query.includes('sale') || 
        query.includes('today') || 
        query.includes('kitna kamaya') || 
        query.includes('selling') || 
        query.includes('earn') ||
        query.includes('dhandha') ||
        query.includes('report')
      ) {
        return res.json({
          reply: `📊 **Sales & Billing Statistics:**\n\n` +
                 `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
                 `- **Total Sales (All Time)**: ₹${stats.totalSales.toFixed(2)}\n` +
                 `- **Total Bills Issued**: ${stats.totalBillsCount} bills\n` +
                 `- **Top-Selling Items**: ${stats.topProductsList.map(p => `${p.product} (${p.quantity} sold)`).join(', ') || 'No sales recorded yet.'}`
        });
      }

      // 9. Credit Dues Stats
      if (
        query.includes('udhaar') || 
        query.includes('credit') || 
        query.includes('debt') || 
        query.includes('due') || 
        query.includes('baaki') ||
        query.includes('kiska') ||
        query.includes('payment')
      ) {
        return res.json({
          reply: `💸 **Credit & Udhaar Ledger Outstanding Dues:**\n\n` +
                 `- **Total Outstanding Dues**: ₹${stats.totalCredit.toFixed(2)}\n` +
                 `- **Top Customer Dues**:\n` +
                 (stats.topDebtorsList.map(d => `  * ${d.customer}: ₹${d.amount.toFixed(2)}`).join('\n') || '  * No outstanding credit dues.')
        });
      }

      // 10. Inventory Stock Stats
      if (
        query.includes('stock') || 
        query.includes('inventory') || 
        query.includes('product') || 
        query.includes('item')
      ) {
        return res.json({
          reply: `📦 **Inventory & Stock Summary:**\n\n` +
                 `- **Total Products in Catalog**: ${stats.totalProductsCount} items\n` +
                 `- **Low Stock Items**: ${stats.lowStockList.join(', ') || 'All items have healthy stock levels!'}`
        });
      }

      // 11. Default General summary / greetings fallback
      return res.json({
        reply: `👋 Hello! I am your Mohuri AI Assistant.\n\n` +
               `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
               `- **Total Outstanding Credit**: ₹${stats.totalCredit.toFixed(2)}\n` +
               `- **Total Products in Catalog**: ${stats.totalProductsCount} items\n\n` +
               `How can I help you manage your store today?`
      });
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

MOHURI OFFICIAL CONTACT & SUPPORT HELPDESK INFO:
- Support Email: support@detalogy.com
- Phone Helpline & WhatsApp Support: +91 76799 37056
- Working Hours: Monday to Saturday, 9:00 AM to 7:00 PM IST
- Developed/Owned by: Detalogy

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

Your task is to answer the user's question. If they ask about support channels, helpline numbers, or developer contact information, use the MOHURI OFFICIAL CONTACT & SUPPORT HELPDESK INFO to answer accurately!

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

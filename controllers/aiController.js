const axios = require('axios');
const Product = require('../models/Product');
const Bill = require('../models/Bill');
const ChatSession = require('../models/ChatSession');

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

// @desc    Get all chat sessions for the logged-in user
// @route   GET /api/ai/sessions
// @access  Private
const getSessions = async (req, res) => {
  try {
    const sessions = await ChatSession.find({ userId: req.user._id }).sort({ updatedAt: -1 });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a new empty chat session
// @route   POST /api/ai/sessions
// @access  Private
const createSession = async (req, res) => {
  try {
    const session = await ChatSession.create({
      userId: req.user._id,
      title: req.body.title || 'New Chat',
      messages: []
    });
    res.status(201).json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get specific chat session detail
// @route   GET /api/ai/sessions/:id
// @access  Private
const getSessionById = async (req, res) => {
  try {
    const session = await ChatSession.findOne({ _id: req.params.id, userId: req.user._id });
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json(session);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a specific chat session
// @route   DELETE /api/ai/sessions/:id
// @access  Private
const deleteSession = async (req, res) => {
  try {
    const session = await ChatSession.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }
    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send a message and run the Tool-Calling conversational AI loop
// @route   POST /api/ai/chat/:sessionId?
// @access  Private
const chatWithAssistant = async (req, res) => {
  const { message } = req.body;
  let sessionId = req.params.sessionId;

  if (!message) {
    return res.status(400).json({ message: 'Message is required' });
  }

  const query = message.toLowerCase().trim();
  const apiKey = process.env.GEMINI_API_KEY;

  try {
    let session;
    if (sessionId && sessionId !== 'null' && sessionId !== 'undefined') {
      session = await ChatSession.findOne({ _id: sessionId, userId: req.user._id });
    }

    if (!session) {
      session = await ChatSession.create({
        userId: req.user._id,
        title: message.substring(0, 30) || 'New Chat',
        messages: []
      });
    }

    // Add user message to history
    session.messages.push({ sender: 'user', text: message, timestamp: new Date() });
    await session.save();

    const stats = await getStoreStats(req.user._id);
    let reply = '';
    let toolUsed = null;

    if (apiKey) {
      // Gemini API Tool / Function Declarations
      const tools = [
        {
          functionDeclarations: [
            {
              name: 'searchProducts',
              description: 'Search products in the inventory catalog by query string',
              parameters: {
                type: 'OBJECT',
                properties: {
                  query: { type: 'STRING', description: 'The search term for products' }
                },
                required: ['query']
              }
            },
            {
              name: 'searchCustomers',
              description: 'Search customer phone directories and outstanding balances',
              parameters: {
                type: 'OBJECT',
                properties: {
                  query: { type: 'STRING', description: 'The search query for customer name/phone' }
                },
                required: ['query']
              }
            },
            {
              name: 'createProduct',
              description: 'Create and register a new product in the store catalog inventory',
              parameters: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING', description: 'Product name' },
                  price: { type: 'NUMBER', description: 'Selling price of the product' },
                  stock: { type: 'NUMBER', description: 'Initial stock count' },
                  buyingCost: { type: 'NUMBER', description: 'Buying cost of the product (optional)' },
                  barcode: { type: 'STRING', description: 'EAN Barcode string (optional)' }
                },
                required: ['name', 'price', 'stock']
              }
            },
            {
              name: 'createInvoice',
              description: 'Generate a new tax invoice/bill for a customer with items',
              parameters: {
                type: 'OBJECT',
                properties: {
                  customerName: { type: 'STRING', description: 'Customer name' },
                  customerPhone: { type: 'STRING', description: 'Customer 10-digit phone number' },
                  paymentType: { type: 'STRING', enum: ['Paid', 'Credit'], description: 'Payment type (Paid or Credit/Udhaar)' },
                  downpayment: { type: 'NUMBER', description: 'Initial payment amount collected today (default 0)' },
                  items: {
                    type: 'ARRAY',
                    description: 'List of invoice items',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        productName: { type: 'STRING', description: 'Product name' },
                        price: { type: 'NUMBER', description: 'Unit price' },
                        quantity: { type: 'NUMBER', description: 'Quantity ordered' }
                      },
                      required: ['productName', 'price', 'quantity']
                    }
                  }
                },
                required: ['customerName', 'customerPhone', 'items', 'paymentType']
              }
            }
          ]
        }
      ];

      const systemInstruction = `
You are the official Mohuri AI Business Assistant, a friendly and highly trained product expert & business analyst for Mohuri - a premium SaaS billing & invoicing platform built by Detalogy.

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

MOHURI OFFICIAL CONTACT & SUPPORT HELPDESK INFO:
- Support Email: support@detalogy.com
- Phone Helpline & WhatsApp Support: +91 76799 37056
- Working Hours: Monday to Saturday, 9:00 AM to 7:00 PM IST
- Developed/Owned by: Detalogy

MOHURI DETAILED SOFTWARE TRAINING DOCUMENTATION:
- Billing / Create Invoice: Go to the "Billing" page in the navigation bar. Select from inventory or add manually. Use voice commands (mic button) or scan barcodes (camera scanner or gun scanner).Settle with Paid or Credit (Udhaar) and click Generate Bill.
- Products / Inventory: Go to "Products" to create, view, edit or delete products (Name, Price, Buying Cost, Stock, Unit, Barcode).
- Credit Ledger: Settle payments on the "Credit" dashboard, send WhatsApp reminders with automatic UPI collection QR codes.
- CRM Campaigns: Go to Settings -> WhatsApp Settings to connect. Go to CRM page to dispatch bulk promotional offers to active customers or debtors.
- Offline Billing: Mohuri works offline via IndexedDB caching. Sync unsynced bills using "Sync Now" button when online.

Your task is to answer the user's question. If they ask to search items, create a product, or create a bill, CALL THE REGISTERED TOOLS directly!
`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      
      // Limit history to last 10 messages for performance and context limits
      const historyMessages = session.messages.slice(-10).map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      const response = await axios.post(geminiUrl, {
        contents: historyMessages,
        tools: tools,
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        }
      });

      const candidate = response.data?.candidates?.[0];
      const part = candidate?.content?.parts?.[0];

      // Check if LLM requested a function call
      if (part?.functionCall) {
        const { name: toolName, args } = part.functionCall;
        toolUsed = toolName;
        let toolResult = null;

        try {
          if (toolName === 'searchProducts') {
            const results = await Product.find({
              userId: req.user._id,
              name: { $regex: args.query, $options: 'i' }
            }).limit(8);
            toolResult = results.map(p => ({ id: p._id, name: p.name, price: p.price, stock: p.stock }));
          } 
          else if (toolName === 'searchCustomers') {
            const results = await Bill.find({
              userId: req.user._id,
              $or: [
                { customerName: { $regex: args.query, $options: 'i' } },
                { customerPhone: { $regex: args.query, $options: 'i' } }
              ]
            }).distinct('customerPhone');
            
            const customers = [];
            for (const phone of results) {
              const lastBill = await Bill.findOne({ userId: req.user._id, customerPhone: phone }).sort({ createdAt: -1 });
              if (lastBill) {
                customers.push({ name: lastBill.customerName, phone: lastBill.customerPhone, outstanding: lastBill.remainingAmount });
              }
            }
            toolResult = customers;
          }
          else if (toolName === 'createProduct') {
            const newProduct = await Product.create({
              userId: req.user._id,
              name: args.name,
              price: args.price,
              stock: args.stock,
              buyingCost: args.buyingCost || 0,
              barcode: args.barcode || ''
            });
            toolResult = { message: 'Product created successfully', product: { id: newProduct._id, name: newProduct.name, price: newProduct.price } };
          }
          else if (toolName === 'createInvoice') {
            const itemsWithTotals = args.items.map(item => ({
              ...item,
              total: item.price * item.quantity
            }));
            const billTotal = itemsWithTotals.reduce((sum, item) => sum + item.total, 0);
            
            const newBill = await Bill.create({
              userId: req.user._id,
              customerName: args.customerName,
              customerPhone: args.customerPhone,
              items: itemsWithTotals,
              total: billTotal,
              paymentType: args.paymentType,
              remainingAmount: args.paymentType === 'Credit' ? (billTotal - (args.downpayment || 0)) : 0,
              status: args.paymentType === 'Credit' ? 'pending' : 'paid'
            });
            toolResult = { message: 'Invoice generated successfully', invoiceId: newBill._id, total: newBill.total };
          }
        } catch (toolErr) {
          console.error(`Tool execution failed for ${toolName}:`, toolErr);
          toolResult = { error: toolErr.message };
        }

        // Feed tool execution response back to Gemini to get final conversational reply
        const toolResponse = await axios.post(geminiUrl, {
          contents: [
            ...historyMessages,
            {
              role: 'model',
              parts: [part]
            },
            {
              role: 'user',
              parts: [{
                functionResponse: {
                  name: toolName,
                  response: { result: toolResult }
                }
              }]
            }
          ],
          tools: tools,
          systemInstruction: {
            parts: [{ text: systemInstruction }]
          }
        });

        reply = toolResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text || "Completed tool execution.";
      } else {
        reply = part?.text || "I couldn't process your request.";
      }

    } else {
      // Fallback local resolver
      if (
        (query.includes('bill') || query.includes('invoice') || query.includes('billing') || query.includes('receipt')) &&
        (query.includes('how') || query.includes('kaise') || query.includes('create') || query.includes('banaye') || query.includes('karo') || query.includes('print'))
      ) {
        reply = `📄 **Billing & Invoice Creation Guide:**\n\n` +
               `1. Go to the **Billing** page from the sidebar.\n` +
               `2. Choose from **Inventory** to select saved products or use **Add Manually** for custom items.\n` +
               `3. **Fast Barcode Scan**: Scan with a USB gun anywhere on the screen, or click the **Camera icon** to scan EAN/UPC barcodes using your phone camera.\n` +
               `4. **Voice commands**: Tap the pulsing microphone button and speak (e.g., *"2 kg sugar aur 1 packet milk"*).\n` +
               `5. Select **Paid** or **Credit (Udhaar)** payment method and click **Generate Bill** to save, print (A4, A5, thermal roll size), and share the PDF invoice directly on WhatsApp!`;
      } else if (
        (query.includes('product') || query.includes('item') || query.includes('inventory')) &&
        (query.includes('add') || query.includes('create') || query.includes('how') || query.includes('kaise') || query.includes('nayan') || query.includes('edit'))
      ) {
        reply = `📦 **Product & Inventory Management Guide:**\n\n` +
               `1. Go to the **Products** page from the sidebar.\n` +
               `2. Click the **Add Product** form field.\n` +
               `3. Enter the Product Name, Price (selling rate), GST (%), Stock, and Buying Cost (to calculate profit margins).\n` +
               `4. **Barcode setup**: Scan EAN barcodes using your camera scanner or machine gun directly in the form input field.\n` +
               `5. Click **Save** to index the product, making it searchable instantly on the checkout page!`;
      } else if (
        query.includes('customer') &&
        (query.includes('add') || query.includes('create') || query.includes('how') || query.includes('kaise') || query.includes('new'))
      ) {
        reply = `👤 **Customer Management Guide:**\n\n` +
               `1. Go to the **Customers** page from the sidebar.\n` +
               `2. You can view all registered customer names, phone numbers, registration dates, and outstanding credit balances.\n` +
               `3. A new customer is automatically created and saved whenever you generate a bill under their name and phone number on the checkout page!`;
      } else if (
        query.includes('offer') || 
        query.includes('crm') || 
        query.includes('campaign') || 
        query.includes('marketing') || 
        query.includes('bulk')
      ) {
        reply = `💬 **WhatsApp CRM & Marketing Offers Guide:**\n\n` +
               `1. **Connect Account**: Go to **Settings** and scan the WhatsApp QR/API connection.\n` +
               `2. **Send Offers**: Go to the **CRM** page in the sidebar.\n` +
               `3. Compose your promotion/marketing offer message text.\n` +
               `4. Select target audience filters (e.g. active customer base, or debtors list).\n` +
               `5. Click **Send** to dispatch bulk marketing messages directly via WhatsApp!`;
      } else if (
        query.includes('udhaar') || 
        query.includes('credit')
      ) {
        if (!(query.includes('how much') || query.includes('kitna') || query.includes('check') || query.includes('kiska') || query.includes('bal') || query.includes('list'))) {
          reply = `💸 **How Credit (Udhaar) Management Works:**\n\n` +
                 `1. **Record Udhaar**: During checkout, select payment method **Credit (Udhaar)**, set a Reminder Date, and specify any downpayment amount.\n` +
                 `2. **Automated Reminders**: Open the **Credit** dashboard to view outstanding dues, log partial settlements, and click **Send WhatsApp Reminder**.\n` +
                 `3. **UPI Payment Link**: Entering your UPI ID in **Settings** automatically appends a secure payment link and collection QR code to all WhatsApp reminder messages!`;
        }
      } else if (
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
        reply = `📞 **Mohuri Support Desk (Detalogy):**\n\n` +
               `- **WhatsApp & Phone Support**: +91 76799 37056\n` +
               `- **Support Email**: support@detalogy.com\n` +
               `- **Working Hours**: Monday to Saturday, 9:00 AM - 7:00 PM IST\n\n` +
               `Please contact us if you need help, have queries, or want customized updates!`;
      } else if (query.includes('offline') || query.includes('internet') || query.includes('indexeddb') || query.includes('sync')) {
        reply = `🔌 **Offline Mode & Cloud Sync Guide:**\n\n` +
               `- Mohuri stores products locally in browser IndexedDB. If internet is down, you can still query inventory and save bills.\n` +
               `- Unsynced invoices will display in an orange banner on the screen.\n` +
               `- When you settle connection, click **Sync Now** to upload cached sales to the server.`;
      } else if (
        query.includes('sale') || 
        query.includes('today') || 
        query.includes('kitna kamaya') || 
        query.includes('selling') || 
        query.includes('earn') ||
        query.includes('dhandha') ||
        query.includes('report')
      ) {
        reply = `📊 **Sales & Billing Statistics:**\n\n` +
               `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
               `- **Total Sales (All Time)**: ₹${stats.totalSales.toFixed(2)}\n` +
               `- **Total Bills Issued**: ${stats.totalBillsCount} bills\n` +
               `- **Top-Selling Items**: ${stats.topProductsList.map(p => `${p.product} (${p.quantity} sold)`).join(', ') || 'No sales recorded yet.'}`;
      } else if (
        query.includes('udhaar') || 
        query.includes('credit') || 
        query.includes('debt') || 
        query.includes('due') || 
        query.includes('baaki') ||
        query.includes('kiska') ||
        query.includes('payment')
      ) {
        reply = `💸 **Credit & Udhaar Ledger Outstanding Dues:**\n\n` +
               `- **Total Outstanding Dues**: ₹${stats.totalCredit.toFixed(2)}\n` +
               `- **Top Customer Dues**:\n` +
               (stats.topDebtorsList.map(d => `  * ${d.customer}: ₹${d.amount.toFixed(2)}`).join('\n') || '  * No outstanding credit dues.');
      } else if (
        query.includes('stock') || 
        query.includes('inventory') || 
        query.includes('product') || 
        query.includes('item')
      ) {
        reply = `📦 **Inventory & Stock Summary:**\n\n` +
               `- **Total Products in Catalog**: ${stats.totalProductsCount} items\n` +
               `- **Low Stock Items**: ${stats.lowStockList.join(', ') || 'All items have healthy stock levels!'}`;
      } else {
        reply = `👋 Hello! I am your Mohuri AI Assistant.\n\n` +
               `- **Today's Sales**: ₹${stats.todaySales.toFixed(2)}\n` +
               `- **Total Outstanding Credit**: ₹${stats.totalCredit.toFixed(2)}\n` +
               `- **Total Products in Catalog**: ${stats.totalProductsCount} items\n\n` +
               `How can I help you manage your store today?`;
      }
    }

    // Add assistant response to history
    session.messages.push({ sender: 'assistant', text: reply, timestamp: new Date() });
    
    // Update session title dynamically based on first message if default
    if (session.title === 'New Chat' || session.title.startsWith('New Chat')) {
      session.title = message.substring(0, 30);
    }
    
    await session.save();

    res.json({
      reply,
      sessionId: session._id,
      sessionTitle: session.title,
      toolUsed
    });

  } catch (error) {
    console.error('Error in chatWithAssistant loop:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  chatWithAssistant,
  getSessions,
  createSession,
  getSessionById,
  deleteSession
};

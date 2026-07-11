const axios = require('axios');

// @desc    Chat with Mohuri AI Assistant product expert (Local Resolver)
// @route   POST /api/ai/chat
// @access  Private
const chatWithAssistant = async (req, res) => {
  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ message: 'Message is required' });
  }

  const query = message.toLowerCase().trim();

  // 1. Billing / Create Invoice
  if (
    query.includes('bill') || 
    query.includes('invoice') || 
    query.includes('create') || 
    query.includes('billing') || 
    query.includes('tax') || 
    query.includes('print') || 
    query.includes('pdf') ||
    query.includes('download') ||
    query.includes('karo') || 
    query.includes('banaye')
  ) {
    return res.json({
      reply: `📄 **How to Manage Billing & Invoices in Mohuri:**\n\n` +
             `1. **Create a Bill**: Go to the **Billing** page. You can search & select products from your "Inventory" or switch to "Add Manually" for a custom one-off item.\n` +
             `2. **Voice Assistant**: Click the glowing mic icon to speak out orders (e.g. *"2 kg sugar aur 3 piece bread"*).\n` +
             `3. **Barcode Scanning**: Scan product barcodes globally using a USB gun scanner, or click the Camera button to scan EAN/UPC labels with your phone camera.\n` +
             `4. **Save & Share**: Select payment type (**Paid** or **Credit/Udhaar**) and click **Generate Bill**. You can open/print the tax PDF (A4, A5, thermal roll size) and share reminders on WhatsApp!`
    });
  }

  // 2. Products / Inventory
  if (
    query.includes('product') || 
    query.includes('item') || 
    query.includes('inventory') || 
    query.includes('stock') || 
    query.includes('price') || 
    query.includes('gst') || 
    query.includes('barcode') ||
    query.includes('buying') ||
    query.includes('cost')
  ) {
    return res.json({
      reply: `📦 **How to Manage Products & Inventory:**\n\n` +
             `1. Go to the **Products** page to view, add, or edit your items.\n` +
             `2. Enter the Product Name, Price (selling rate), GST (%), Stock Quantity, Unit (pcs/kg), and Buying Cost (for profit calculations).\n` +
             `3. **Barcode Setup**: You can scan product barcodes directly using a scanner machine gun or tap the **Camera Icon** next to the input to scan it with your phone's camera.\n` +
             `4. Saving a product automatically indexes it, making it searchable instantly on the checkout page!`
    });
  }

  // 3. Credit / Udhaar Management
  if (
    query.includes('udhaar') || 
    query.includes('credit') || 
    query.includes('payment') || 
    query.includes('pay') || 
    query.includes('remind') || 
    query.includes('reminder') ||
    query.includes('due') ||
    query.includes('date') ||
    query.includes('qr') ||
    query.includes('upi')
  ) {
    return res.json({
      reply: `💸 **How Udhaar (Credit) Management Works:**\n\n` +
             `1. **Record Credit**: During checkout on the billing page, select **Credit (Udhaar)**, set a Reminder Date, and enter any initial payment amount.\n` +
             `2. **Customer Ledger**: The remaining unpaid balance is automatically logged under the customer's profile in the **Customers** directory.\n` +
             `3. **Credit Dashboard**: Open the **Credit** dashboard to view overall outstanding balances, record customer repayments, and send WhatsApp reminders.\n` +
             `4. **UPI Payments**: If you enter a UPI ID in Settings, your WhatsApp reminder messages will automatically include a secure UPI payment link and dynamic collection QR code!`
    });
  }

  // 4. WhatsApp & CRM Campaigns
  if (
    query.includes('whatsapp') || 
    query.includes('crm') || 
    query.includes('campaign') || 
    query.includes('marketing') || 
    query.includes('offer') || 
    query.includes('bulk') ||
    query.includes('connect') ||
    query.includes('template')
  ) {
    return res.json({
      reply: `💬 **WhatsApp Connection & CRM Marketing Offers:**\n\n` +
             `1. **Connect WhatsApp**: Go to **Settings** and link your WhatsApp API or scan the QR code to connect your business account.\n` +
             `2. **Custom Templates**: You can configure custom billing reminder templates in settings using placeholders like {customerName}, {remainingAmount}, and {invoiceNo}.\n` +
             `3. **CRM Bulk Campaigns**: Go to the **CRM** page, write your campaign message, select your audience from your customer list, and send promotions or festival offers directly via WhatsApp!`
    });
  }

  // 5. Offline Billing
  if (
    query.includes('offline') || 
    query.includes('internet') || 
    query.includes('connection') || 
    query.includes('network') || 
    query.includes('sync')
  ) {
    return res.json({
      reply: `🔌 **How Offline Billing Works in Mohuri:**\n\n` +
             `1. **Zero Disconnection**: If your internet drops, you can continue to check out. Mohuri uses browser IndexedDB caching to load products/customers and save offline invoices locally.\n` +
             `2. **Offline Indicator**: A banner will appear at the top showing the number of offline-saved bills.\n` +
             `3. **Cloud Sync**: Once internet is restored, simply click **Sync Now** on the top banner. All pending offline bills will automatically write to your central cloud database.`
    });
  }

  // 6. Reports & Sales stats
  if (
    query.includes('report') || 
    query.includes('sales') || 
    query.includes('profit') || 
    query.includes('analytic') || 
    query.includes('stat') ||
    query.includes('today') ||
    query.includes('sale')
  ) {
    return res.json({
      reply: `📊 **Reports & Live Store Statistics:**\n\n` +
             `- Go to the **Dashboard** to view aggregate sales graphs, total profits, total credit summaries, and low-stock indicators.\n` +
             `- *Note*: Live database querying through chat (like asking *"How much sale did I do today?"*) is currently in preparation. Our systems are fully future-ready, and this automated stats feature will launch in the next update!`
    });
  }

  // 7. Settings & Profile
  if (
    query.includes('setting') || 
    query.includes('profile') || 
    query.includes('update') || 
    query.includes('business') || 
    query.includes('address') || 
    query.includes('phone')
  ) {
    return res.json({
      reply: `⚙️ **Updating Settings & Store Profile:**\n\n` +
             `- Go to the **Settings** page in the sidebar.\n` +
             `- Update your store name, billing address, and phone number.\n` +
             `- **UPI Configuration**: Enter your UPI ID (e.g. *upi@okaxis*) and UPI merchant name to enable automated credit QR generation on invoices.\n` +
             `- **Custom Reminders**: Set up your custom default reminder text templates for WhatsApp shares.`
    });
  }

  // 8. General Greetings
  if (
    query.includes('hello') || 
    query.includes('hi') || 
    query.includes('hey') || 
    query.includes('welcome') ||
    query.includes('help') ||
    query.includes('assistant') ||
    query.includes('support')
  ) {
    return res.json({
      reply: `👋 Hello! I am your Mohuri AI Assistant.\n\n` +
             `I can guide you through every feature of our software. Try asking me:\n` +
             `- *"How do I create a bill?"*\n` +
             `- *"How do I add a product?"*\n` +
             `- *"How does Udhaar work?"*\n` +
             `- *"How do I connect WhatsApp?"*\n` +
             `- *"How does offline billing work?"*`
    });
  }

  // 9. Generic Fallback
  return res.json({
    reply: `🤖 **Mohuri AI Support Executive:**\n\n` +
           `I couldn't match that query to a specific Mohuri module. As your product support expert, I can help you with:\n\n` +
           `- **Billing & Voice Commands** (creating paid/credit bills)\n` +
           `- **Inventory & Barcodes** (adding items with camera scans)\n` +
           `- **Udhaar & Credit Dashboard** (recording customer balances & sending UPI QR links)\n` +
           `- **WhatsApp CRM Marketing** (bulk messages & templates)\n` +
           `- **Offline Mode** (IndexDB storage and cloud synchronization)\n\n` +
           `Please ask about any of these features, or select one of our suggested questions below!`
  });
};

module.exports = {
  chatWithAssistant,
};

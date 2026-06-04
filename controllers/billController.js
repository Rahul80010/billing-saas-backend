const Bill = require('../models/Bill');
const Product = require('../models/Product');
const { sendWhatsappBill } = require('../services/whatsappService');
const { generateInvoicePdf } = require('../services/pdfService');

// @desc    Get all bills
// @route   GET /api/bills
// @access  Private
const getBills = async (req, res) => {
  try {
    const query = { userId: req.user._id };
    if (req.query.phone) {
      query.customerPhone = req.query.phone;
    }
    const bills = await Bill.find(query).sort({ createdAt: -1 });
    res.json(bills);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a bill
// @route   POST /api/bills
// @access  Private
const createBill = async (req, res) => {
  const { customerName, customerPhone, items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'No valid bill items provided' });
  }

  try {
    // Calculate total
    let total = 0;
    const processedItems = [];

    for (const item of items) {
      const price = Number(item.price);
      const quantity = Number(item.quantity);
      const gst = Number(item.gst);

      if (!item.productName || isNaN(price) || price < 0 || isNaN(quantity) || quantity < 0 || isNaN(gst) || gst < 0) {
        throw new Error(`Invalid or missing fields for item: ${item.productName || 'Unknown'}`);
      }

      // Calculate item total: (price * quantity) + gst amount
      const itemTotalWithoutGst = price * quantity;
      const gstAmount = (itemTotalWithoutGst * gst) / 100;
      const finalItemTotal = itemTotalWithoutGst + gstAmount;
      
      total += finalItemTotal;

      processedItems.push({
        productName: item.productName,
        price,
        quantity,
        gst,
      });
    }

    const bill = new Bill({
      userId: req.user._id,
      customerName,
      customerPhone,
      items: processedItems,
      total: Number(total.toFixed(2)),
    });

    const createdBill = await bill.save();

    // Auto deduct product stock in the background (non-blocking)
    try {
      for (const item of processedItems) {
        await Product.findOneAndUpdate(
          { userId: req.user._id, name: item.productName },
          { $inc: { stock: -item.quantity } }
        );
      }
    } catch (stockErr) {
      console.error('Error auto-deducting stock:', stockErr);
    }

    // Trigger WhatsApp bill in the background (non-blocking)
    if (customerPhone) {
      const businessName = req.user.businessName || req.user.name;
      const pdfLink = `${req.protocol}://${req.get('host')}/api/bills/${createdBill._id}/pdf`;
      const userConfig = {
        whatsappToken: req.user.whatsappToken,
        whatsappPhoneNumberId: req.user.whatsappPhoneNumberId
      };
      sendWhatsappBill(customerPhone, customerName, createdBill.total, pdfLink, businessName, userConfig);
    }

    res.status(201).json(createdBill);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Get dynamic PDF invoice for a bill
// @route   GET /api/bills/:id/pdf
// @access  Public
const getBillPdf = async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id).populate('userId');
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    const businessConfig = {
      businessName: bill.userId?.businessName || bill.userId?.name || 'MOHURI Invoice',
      businessAddress: bill.userId?.businessAddress || '',
      businessPhone: bill.userId?.businessPhone || '',
      gstin: bill.userId?.gstin || '',
      invoiceFooter: bill.userId?.invoiceFooter || '',
      logo: bill.userId?.logo || ''
    };

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=invoice_${bill._id.toString().slice(-6).toUpperCase()}.pdf`);

    generateInvoicePdf(bill, businessConfig, res);
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getBills,
  createBill,
  getBillPdf,
};

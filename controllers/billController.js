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

    if (req.query.paymentType) {
      query.paymentType = req.query.paymentType;
    }

    if (req.query.status) {
      if (req.query.status === 'overdue') {
        query.status = { $in: ['pending', 'partial'] };
        query.dueDate = { $lt: new Date() };
      } else {
        query.status = req.query.status;
      }
    }

    if (req.query.search) {
      const searchRegex = new RegExp(req.query.search, 'i');
      query.$or = [
        { customerName: searchRegex },
        { customerPhone: searchRegex }
      ];
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
  const { customerName, customerPhone, items, paymentType, dueDate, paidAmount } = req.body;

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

    const finalTotal = Number(total.toFixed(2));
    let finalPaidAmount = 0;
    let finalRemainingAmount = 0;
    let finalStatus = 'paid';
    let finalDueDate = null;

    if (paymentType === 'Credit') {
      finalPaidAmount = Math.max(0, Number(paidAmount || 0));
      // Ensure we don't pay more than the total
      finalPaidAmount = Math.min(finalPaidAmount, finalTotal);
      finalRemainingAmount = Number((finalTotal - finalPaidAmount).toFixed(2));
      
      if (finalRemainingAmount <= 0) {
        finalStatus = 'paid';
        finalRemainingAmount = 0;
      } else if (finalPaidAmount > 0) {
        finalStatus = 'partial';
      } else {
        finalStatus = 'pending';
      }
      
      finalDueDate = dueDate ? new Date(dueDate) : null;
    } else {
      // paymentType = 'Paid'
      finalPaidAmount = finalTotal;
      finalRemainingAmount = 0;
      finalStatus = 'paid';
      finalDueDate = null;
    }

    const bill = new Bill({
      userId: req.user._id,
      customerName,
      customerPhone,
      items: processedItems,
      total: finalTotal,
      paymentType: paymentType || 'Paid',
      dueDate: finalDueDate,
      paidAmount: finalPaidAmount,
      remainingAmount: finalRemainingAmount,
      status: finalStatus,
      payments: finalPaidAmount > 0 ? [{
        amount: finalPaidAmount,
        note: paymentType === 'Credit' ? 'Initial down payment' : 'Full payment at billing',
        date: new Date()
      }] : []
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

// @desc    Get credit stats for dashboard
// @route   GET /api/bills/credit/stats
// @access  Private
const getCreditStats = async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();

    // Fetch all unpaid/partial credit bills for the user
    const creditBills = await Bill.find({
      userId,
      paymentType: 'Credit',
      status: { $in: ['pending', 'partial'] }
    });

    let totalCreditOutstanding = 0;
    let overdueAmount = 0;
    const pendingCustomersSet = new Set();
    const overdueCustomersSet = new Set();

    creditBills.forEach(bill => {
      totalCreditOutstanding += bill.remainingAmount;
      
      const isOverdue = bill.dueDate && new Date(bill.dueDate) < now;
      if (isOverdue) {
        overdueAmount += bill.remainingAmount;
        overdueCustomersSet.add(bill.customerPhone || bill.customerName);
      }
      
      pendingCustomersSet.add(bill.customerPhone || bill.customerName);
    });

    res.json({
      totalCreditOutstanding: Number(totalCreditOutstanding.toFixed(2)),
      overdueAmount: Number(overdueAmount.toFixed(2)),
      pendingCustomersCount: pendingCustomersSet.size,
      overdueCustomersCount: overdueCustomersSet.size
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Record a payment for a bill
// @route   POST /api/bills/:id/payments
// @access  Private
const recordPayment = async (req, res) => {
  const { amount, note } = req.body;
  const paymentAmount = Number(amount);

  if (isNaN(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ message: 'Invalid payment amount' });
  }

  try {
    const bill = await Bill.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ message: 'Bill is already fully paid' });
    }

    // Limit payment amount to remaining amount to avoid overpayment
    const actualPayment = Math.min(paymentAmount, bill.remainingAmount);

    bill.paidAmount = Number((bill.paidAmount + actualPayment).toFixed(2));
    bill.remainingAmount = Number((bill.total - bill.paidAmount).toFixed(2));

    if (bill.remainingAmount <= 0) {
      bill.status = 'paid';
      bill.remainingAmount = 0; // Guard against floating point underflow
    } else {
      bill.status = 'partial';
    }

    // Add to payment history
    bill.payments.push({
      amount: actualPayment,
      note: note || '',
      date: new Date(),
    });

    const updatedBill = await bill.save();
    res.json(updatedBill);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getBills,
  createBill,
  getBillPdf,
  getCreditStats,
  recordPayment,
};

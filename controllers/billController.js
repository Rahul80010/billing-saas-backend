const Bill = require('../models/Bill');
const Product = require('../models/Product');
const { sendWhatsappBill, sendWhatsAppMessage, formatPhoneNumber } = require('../services/whatsappService');
const { generateInvoicePdf } = require('../services/pdfService');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const { decrypt } = require('../services/encryptionService');

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
  const { customerName, customerPhone, customerAddress, items, paymentType, dueDate, paidAmount } = req.body;

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
      customerAddress,
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

    // Create system notification for new bill
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        user: req.user._id,
        title: paymentType === 'Credit' ? 'New Credit Bill (Udhaar)' : 'New Invoice Generated',
        message: paymentType === 'Credit' 
          ? `Invoice generated with outstanding credit of ₹${finalRemainingAmount} for customer "${customerName}".`
          : `Invoice #INV-${createdBill._id.toString().substring(0,6).toUpperCase()} generated for customer "${customerName}" (Amount: ₹${finalTotal}).`,
        type: paymentType === 'Credit' ? 'credit' : 'system'
      });
    } catch (notifErr) {
      console.error('Failed to create bill notification:', notifErr);
    }

    // Auto deduct product stock in the background (non-blocking)
    try {
      for (const item of processedItems) {
        const updatedProduct = await Product.findOneAndUpdate(
          { userId: req.user._id, name: item.productName },
          { $inc: { stock: -item.quantity } },
          { new: true }
        );
        if (updatedProduct) {
          const Notification = require('../models/Notification');
          if (updatedProduct.stock <= 0) {
            await Notification.create({
              user: req.user._id,
              title: 'Out of Stock Alert',
              message: `Product "${updatedProduct.name}" is completely out of stock!`,
              type: 'stock'
            });
          } else if (updatedProduct.stock <= 5) {
            await Notification.create({
              user: req.user._id,
              title: 'Low Stock Warning',
              message: `Product "${updatedProduct.name}" is running low on stock. Only ${updatedProduct.stock} items left.`,
              type: 'stock'
            });
          }
        }
      }
    } catch (stockErr) {
      console.error('Error auto-deducting stock:', stockErr);
    }

    // Trigger WhatsApp bill in the background (non-blocking)
    if (customerPhone) {
      const businessName = req.user.businessName || req.user.name;
      const backendBaseUrl = process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`;
      const pdfLink = `${backendBaseUrl}/api/bills/${createdBill._id}/pdf`;
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
  const { amount, note, dueDate } = req.body;
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
      if (dueDate) {
        bill.dueDate = new Date(dueDate);
      }
    }

    // Add to payment history
    bill.payments.push({
      amount: actualPayment,
      note: note || '',
      date: new Date(),
    });

    const updatedBill = await bill.save();

    // Create notification
    try {
      const Notification = require('../models/Notification');
      await Notification.create({
        user: req.user._id,
        title: 'Payment Recorded',
        message: `Received payment of ₹${actualPayment} for bill #INV-${bill._id.toString().substring(0,6).toUpperCase()} of customer "${bill.customerName}". Remaining: ₹${bill.remainingAmount}.`,
        type: 'credit'
      });
    } catch (notifErr) {
      console.error('Failed to create payment notification:', notifErr);
    }

    res.json(updatedBill);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Record a bulk payment for a customer (settles oldest bills first)
// @route   POST /api/bills/customer/:phone/payments
// @access  Private
const recordCustomerPayment = async (req, res) => {
  const { amount, note, dueDate } = req.body;
  let paymentAmount = Number(amount);
  const phone = req.params.phone;

  if (isNaN(paymentAmount) || paymentAmount <= 0) {
    return res.status(400).json({ message: 'Invalid payment amount' });
  }

  try {
    // Find all pending/partial credit bills for this customer and user
    const bills = await Bill.find({
      userId: req.user._id,
      customerPhone: phone,
      paymentType: 'Credit',
      status: { $in: ['pending', 'partial'] }
    }).sort({ createdAt: 1 }); // oldest first

    if (bills.length === 0) {
      return res.status(404).json({ message: 'No pending credit invoices found for this customer' });
    }

    const modifiedBills = [];
    const originalPaymentAmount = paymentAmount;

    for (const bill of bills) {
      if (paymentAmount <= 0) break;

      const toPay = Math.min(paymentAmount, bill.remainingAmount);
      paymentAmount = Number((paymentAmount - toPay).toFixed(2));

      bill.paidAmount = Number((bill.paidAmount + toPay).toFixed(2));
      bill.remainingAmount = Number((bill.total - bill.paidAmount).toFixed(2));

      if (bill.remainingAmount <= 0) {
        bill.status = 'paid';
        bill.remainingAmount = 0;
      } else {
        bill.status = 'partial';
      }

      bill.payments.push({
        amount: toPay,
        note: note ? `${note} (Bulk Settlement)` : 'Bulk Customer Settlement',
        date: new Date(),
      });

      modifiedBills.push(bill);
    }

    // Save all modified bills
    for (const bill of modifiedBills) {
      await bill.save();
    }

    // If a new reminder date is provided, update all remaining unpaid/partial bills for this customer
    if (dueDate) {
      await Bill.updateMany(
        {
          userId: req.user._id,
          customerPhone: phone,
          paymentType: 'Credit',
          status: { $in: ['pending', 'partial'] }
        },
        { $set: { dueDate: new Date(dueDate) } }
      );
    }

    // Create notification
    try {
      const Notification = require('../models/Notification');
      const customerName = modifiedBills[0]?.customerName || 'Customer';
      await Notification.create({
        user: req.user._id,
        title: 'Bulk Payment Settlement',
        message: `Settled payment of ₹${(originalPaymentAmount - paymentAmount).toFixed(2)} across ${modifiedBills.length} credit invoices for customer "${customerName}".`,
        type: 'credit'
      });
    } catch (notifErr) {
      console.error('Failed to create bulk payment notification:', notifErr);
    }

    res.json({
      success: true,
      message: `Successfully settled ₹${(originalPaymentAmount - paymentAmount).toFixed(2)} across ${modifiedBills.length} invoice(s).`,
      remainingPayment: paymentAmount,
      settledInvoicesCount: modifiedBills.length
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a bill and restore stock
// @route   DELETE /api/bills/:id
// @access  Private
const deleteBill = async (req, res) => {
  try {
    const bill = await Bill.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    // Restore stock for all products in the bill
    try {
      for (const item of bill.items) {
        await Product.findOneAndUpdate(
          { userId: req.user._id, name: item.productName },
          { $inc: { stock: item.quantity } }
        );
      }
    } catch (stockErr) {
      console.error('Error restoring stock on bill deletion:', stockErr);
    }

    await Bill.deleteOne({ _id: bill._id });
    res.json({ message: 'Bill deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send WhatsApp reminder for a specific credit bill
// @route   POST /api/bills/:id/whatsapp-reminder
// @access  Private
const sendBillWhatsAppReminder = async (req, res) => {
  try {
    const bill = await Bill.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    if (bill.status === 'paid') {
      return res.status(400).json({ message: 'This bill is already fully paid' });
    }

    const customerName = bill.customerName;
    const phone = bill.customerPhone;
    if (!phone) {
      return res.status(400).json({ message: 'Customer phone number is missing' });
    }

    const remainingAmount = bill.remainingAmount.toFixed(2);
    const businessName = req.user.businessName || req.user.name || 'MOHURI';
    const invoiceNo = bill._id.toString().slice(-6).toUpperCase();
    const reminderDateStr = bill.dueDate ? new Date(bill.dueDate).toLocaleDateString('en-IN') : 'N/A';

    // Construct reminder message in Hinglish
    const message = `Hello ${customerName},\n\nThis is a friendly reminder from *${businessName}* that you have an outstanding balance of *₹${remainingAmount}* for Invoice #INV-${invoiceNo}.\n\n*Reminder Date:* ${reminderDateStr}\n\nPlease settle it soon. Thank you! 🙏`;

    // Check if WhatsApp is connected
    const connection = await WhatsAppConnection.findOne({ userId: req.user._id });
    const isConnected = !!connection;

    if (isConnected) {
      const token = decrypt(connection.accessToken);
      const wabaRes = await sendWhatsAppMessage({
        phoneNumberId: connection.phoneNumberId,
        accessToken: token,
        to: phone,
        message
      });

      if (wabaRes.success) {
        return res.json({ success: true, method: 'api' });
      } else {
        console.warn('[WhatsApp Reminder] Meta API failed, falling back to Click-to-Chat:', wabaRes.error);
      }
    }

    // Build Click-to-Chat fallback link
    const cleanPhone = formatPhoneNumber(phone);
    const waPhone = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(message)}`;

    res.json({
      success: false,
      notConnected: true,
      whatsappUrl,
      message: 'WhatsApp connection not configured. Opening WhatsApp Web link as fallback.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Send WhatsApp reminder for all outstanding credit bills of a customer
// @route   POST /api/bills/customer/:phone/whatsapp-reminder
// @access  Private
const sendCustomerWhatsAppReminder = async (req, res) => {
  const phone = req.params.phone;
  try {
    const bills = await Bill.find({
      userId: req.user._id,
      customerPhone: phone,
      paymentType: 'Credit',
      status: { $in: ['pending', 'partial'] }
    }).sort({ dueDate: 1 });

    if (bills.length === 0) {
      return res.status(404).json({ message: 'No outstanding bills found for this customer' });
    }

    const customerName = bills[0].customerName;
    let totalRemainingDue = 0;
    let earliestDueDate = null;

    bills.forEach(bill => {
      totalRemainingDue += bill.remainingAmount;
      if (bill.dueDate) {
        if (!earliestDueDate || new Date(bill.dueDate) < new Date(earliestDueDate)) {
          earliestDueDate = bill.dueDate;
        }
      }
    });

    const outstandingAmt = totalRemainingDue.toFixed(2);
    const businessName = req.user.businessName || req.user.name || 'MOHURI';
    const reminderDateStr = earliestDueDate ? new Date(earliestDueDate).toLocaleDateString('en-IN') : 'N/A';

    // Construct reminder message
    const message = `Hello ${customerName},\n\nThis is a friendly reminder from *${businessName}* that you have a total outstanding balance of *₹${outstandingAmt}* across pending invoices.\n\n*Reminder Date:* ${reminderDateStr}\n\nPlease settle it soon. Thank you! 🙏`;

    // Check WhatsApp Connection
    const connection = await WhatsAppConnection.findOne({ userId: req.user._id });
    const isConnected = !!connection;

    if (isConnected) {
      const token = decrypt(connection.accessToken);
      const wabaRes = await sendWhatsAppMessage({
        phoneNumberId: connection.phoneNumberId,
        accessToken: token,
        to: phone,
        message
      });

      if (wabaRes.success) {
        return res.json({ success: true, method: 'api' });
      } else {
        console.warn('[WhatsApp Reminder] Meta API failed for customer level, falling back to Click-to-Chat:', wabaRes.error);
      }
    }

    // Build Click-to-Chat fallback link
    const cleanPhone = formatPhoneNumber(phone);
    const waPhone = cleanPhone.length === 10 ? '91' + cleanPhone : cleanPhone;
    const whatsappUrl = `https://api.whatsapp.com/send?phone=${waPhone}&text=${encodeURIComponent(message)}`;

    res.json({
      success: false,
      notConnected: true,
      whatsappUrl,
      message: 'WhatsApp connection not configured. Opening WhatsApp Web link as fallback.'
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update reminder date for a bill directly
// @route   PUT /api/bills/:id/reminder-date
// @access  Private
const updateBillReminderDate = async (req, res) => {
  const { dueDate } = req.body;
  if (!dueDate) {
    return res.status(400).json({ message: 'Reminder Date is required' });
  }

  try {
    const bill = await Bill.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' });
    }

    bill.dueDate = new Date(dueDate);
    const updatedBill = await bill.save();

    res.json(updatedBill);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update reminder date for all outstanding bills of a customer
// @route   PUT /api/bills/customer/:phone/reminder-date
// @access  Private
const updateCustomerReminderDate = async (req, res) => {
  const { dueDate } = req.body;
  const phone = req.params.phone;
  if (!dueDate) {
    return res.status(400).json({ message: 'Reminder Date is required' });
  }

  try {
    const result = await Bill.updateMany(
      {
        userId: req.user._id,
        customerPhone: phone,
        paymentType: 'Credit',
        status: { $in: ['pending', 'partial'] }
      },
      { $set: { dueDate: new Date(dueDate) } }
    );

    res.json({ success: true, message: `Updated reminder date for ${result.modifiedCount} bill(s).` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getBills,
  createBill,
  getBillPdf,
  getCreditStats,
  recordPayment,
  recordCustomerPayment,
  deleteBill,
  sendBillWhatsAppReminder,
  sendCustomerWhatsAppReminder,
  updateBillReminderDate,
  updateCustomerReminderDate,
};


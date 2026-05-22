const Bill = require('../models/Bill');

// @desc    Get all bills
// @route   GET /api/bills
// @access  Private
const getBills = async (req, res) => {
  try {
    const bills = await Bill.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(bills);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a bill
// @route   POST /api/bills
// @access  Private
const createBill = async (req, res) => {
  const { customerName, items } = req.body;

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
      items: processedItems,
      total: Number(total.toFixed(2)),
    });

    const createdBill = await bill.save();
    res.status(201).json(createdBill);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

module.exports = {
  getBills,
  createBill,
};

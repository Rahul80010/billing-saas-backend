const mongoose = require('mongoose');

const purchaseItemSchema = new mongoose.Schema({
  productName: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  quantity: {
    type: Number,
    required: true,
    min: 0,
  },
  gst: {
    type: Number,
    default: 0,
    min: 0,
  },
});

const purchaseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true,
    index: true,
  },
  supplierName: {
    type: String,
    required: true,
  },
  items: [purchaseItemSchema],
  total: {
    type: Number,
    required: true,
    min: 0,
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  remainingAmount: {
    type: Number,
    default: 0,
    min: 0,
  },
  status: {
    type: String,
    enum: ['paid', 'pending', 'partial'],
    default: 'paid',
  },
  purchaseDate: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Purchase', purchaseSchema);

const mongoose = require('mongoose');

const stockOrderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductVariant',
    default: null,
  },
  productName: {
    type: String,
    required: true,
  },
  variantName: {
    type: String,
    default: '',
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true, // Recalculated unit selling price from DB
    min: 0,
  },
  buyingCost: {
    type: Number,
    default: 0,
    min: 0,
  },
  gst: {
    type: Number,
    default: 0,
    min: 0,
  },
  unit: {
    type: String,
    default: 'pcs',
  },
  total: {
    type: Number,
    required: true,
  },
});

const stockOrderSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  storeToken: {
    type: String,
    required: true,
    index: true,
  },
  orderNumber: {
    type: String,
    required: true,
  },
  orderToken: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  customerName: {
    type: String,
    required: true,
    trim: true,
  },
  customerPhone: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  deliveryAddress: {
    type: String,
    trim: true,
    default: '',
  },
  notes: {
    type: String,
    trim: true,
    default: '',
  },
  items: [stockOrderItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: 0,
  },
  taxTotal: {
    type: Number,
    default: 0,
    min: 0,
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected'],
    default: 'Pending',
    index: true,
  },
  orderSource: {
    type: String,
    default: 'Customer Stock Link',
  },
  paymentMethod: {
    type: String,
    default: 'Pay at Store / COD',
  },
  isPaid: {
    type: Boolean,
    default: false,
  },
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bill',
    default: null,
  },
  reservedUntil: {
    type: Date,
  },
  statusHistory: [{
    status: {
      type: String,
      required: true,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      default: '',
    },
  }],
}, { timestamps: true });

stockOrderSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('StockOrder', stockOrderSchema);

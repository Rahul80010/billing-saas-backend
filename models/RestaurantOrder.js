const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductVariant',
    required: false,
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
  },
  price: {
    type: Number,
    required: true, // Unit price at the time of order
  },
  specialInstructions: {
    type: String,
    default: '',
  },
});

const restaurantOrderSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RestaurantTable',
    required: true,
  },
  orderNumber: {
    type: String,
    required: true,
  },
  items: [orderItemSchema],
  orderType: {
    type: String,
    enum: ['Dine-in', 'Takeaway', 'Delivery'],
    default: 'Dine-in',
  },
  customerName: {
    type: String,
    default: '',
  },
  customerPhone: {
    type: String,
    default: '',
  },
  notes: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['Received', 'Preparing', 'Ready', 'Served', 'Completed', 'Rejected', 'Cancelled'],
    default: 'Received',
  },
  totalAmount: {
    type: Number,
    required: true,
  },
  serviceCharge: {
    type: Number,
    default: 0,
  },
  isPaid: {
    type: Boolean,
    default: false,
  },
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bill',
    required: false,
  },
  kitchenAcceptedAt: Date,
  readyAt: Date,
  completedAt: Date,
}, { timestamps: true });

restaurantOrderSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('RestaurantOrder', restaurantOrderSchema);

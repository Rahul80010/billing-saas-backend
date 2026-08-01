const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
  },
  variant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Variant',
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
  status: {
    type: String,
    enum: ['Received', 'Preparing', 'Ready', 'Served', 'Completed', 'Cancelled'],
    default: 'Received',
  },
  totalAmount: {
    type: Number,
    required: true,
  },
  isPaid: {
    type: Boolean,
    default: false,
  },
  billId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bill',
    required: false, // Populated once final bill is generated
  }
}, { timestamps: true });

restaurantOrderSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('RestaurantOrder', restaurantOrderSchema);

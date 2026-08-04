const mongoose = require('mongoose');

const restaurantTableSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  tableName: {
    type: String,
    required: true,
  },
  tableNumber: {
    type: Number,
    required: true,
  },
  capacity: {
    type: Number,
    default: 4,
  },
  section: {
    type: String,
    default: 'Ground Floor',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  status: {
    type: String,
    enum: ['Available', 'Occupied', 'Ordering', 'Preparing', 'Ready', 'Eating', 'WaitingForBill', 'Cleaning', 'Reserved'],
    default: 'Available',
  },
  qrCodeData: {
    type: String,
  }
}, { timestamps: true });

// Ensure table numbers are unique per tenant
restaurantTableSchema.index({ tenantId: 1, tableNumber: 1 }, { unique: true });

module.exports = mongoose.model('RestaurantTable', restaurantTableSchema);

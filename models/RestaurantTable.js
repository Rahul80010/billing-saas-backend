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
  isRoom: {
    type: Boolean,
    default: false,
  },
  roomType: {
    type: String,
    enum: ['Standard', 'Deluxe', 'Executive Suite', 'Presidential Suite', 'Villa', 'Cottage', 'Dormitory', 'Single Room', 'Double Room', 'Family Room'],
    default: 'Standard',
  },
  floor: {
    type: String,
    default: '1st Floor',
  },
  currentGuestName: {
    type: String,
    trim: true,
    default: '',
  },
  currentGuestPhone: {
    type: String,
    trim: true,
    default: '',
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

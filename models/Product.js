const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  gst: {
    type: Number,
    default: 0,
    min: 0,
  },
  stock: {
    type: Number,
    default: 0,
    min: 0,
  },
  unit: {
    type: String,
    enum: ['pcs', 'kg'],
    default: 'pcs',
  },
  buyingCost: {
    type: Number,
    default: 0,
    min: 0,
  },
  barcode: {
    type: String,
    trim: true,
    default: '',
  },
  sku: {
    type: String,
    trim: true,
    default: '',
  },
  hsnCode: {
    type: String,
    trim: true,
    default: '',
  },
  category: {
    type: String,
    trim: true,
    default: '',
  },
  lowStockAlert: {
    type: Number,
    default: 5,
    min: 0,
  },
  lowStockAlertEnabled: {
    type: Boolean,
    default: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  foodType: {
    type: String,
    enum: ['Veg', 'Non-Veg', 'Egg'],
    default: 'Veg',
  },
  image: {
    type: mongoose.Schema.Types.Mixed,
    default: '',
  },
  images: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
}, { timestamps: true });

module.exports = mongoose.model('Product', productSchema);

const mongoose = require('mongoose');

const productVariantSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true,
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  variantName: {
    type: String,
    required: true,
    trim: true,
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
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  buyingCost: {
    type: Number,
    default: 0,
    min: 0,
  },
  stock: {
    type: Number,
    default: 0,
    min: 0,
  },
  lowStockAlert: {
    type: Number,
    default: 5,
    min: 0,
  },
  image: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
}, { timestamps: true });

// Compound index: variant name must be unique within same product
productVariantSchema.index({ productId: 1, variantName: 1 }, { unique: true });

module.exports = mongoose.model('ProductVariant', productVariantSchema);

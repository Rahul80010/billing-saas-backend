const mongoose = require('mongoose');

const hsnMasterSchema = new mongoose.Schema({
  hsnCode: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  category: {
    type: String,
    required: true,
    trim: true,
  },
  productName: {
    type: String,
    required: true,
    trim: true,
  },
  gstRate: {
    type: Number,
    default: null,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  keywords: [{
    type: String,
    lowercase: true,
    trim: true,
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },
}, { timestamps: true });

// Prevent duplicate HSN code per category in master database
hsnMasterSchema.index({ hsnCode: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('HsnMaster', hsnMasterSchema);

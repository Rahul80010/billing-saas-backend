const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema({
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
  phone: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    default: '',
  },
  address: {
    type: String,
    default: '',
  },
  outstandingBalance: {
    type: Number,
    default: 0,
    min: 0,
  },
  payments: [{
    amount: { type: Number, required: true },
    paymentDate: { type: Date, default: Date.now },
    paymentMode: { type: String, default: 'Cash' },
    note: { type: String, default: '' }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Supplier', supplierSchema);

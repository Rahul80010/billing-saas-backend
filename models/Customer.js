const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
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
  address: {
    type: String,
    required: false,
  },
  email: {
    type: String,
    trim: true,
    default: '',
  },
  idProofType: {
    type: String,
    enum: ['Aadhaar Card', 'Passport', 'Driving License', 'Voter ID', 'Govt ID', 'PAN Card', 'Other'],
    default: 'Aadhaar Card',
  },
  idProofNumber: {
    type: String,
    trim: true,
    default: '',
  },
  city: {
    type: String,
    trim: true,
    default: '',
  },
  notes: {
    type: String,
    default: '',
  },
  isVip: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

module.exports = mongoose.model('Customer', customerSchema);

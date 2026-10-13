const mongoose = require('mongoose');

const loginLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  userName: {
    type: String,
    required: true,
    trim: true,
  },
  userEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  businessName: {
    type: String,
    default: '',
    trim: true,
  },
  businessPhone: {
    type: String,
    default: '',
    trim: true,
  },
  role: {
    type: String,
    enum: ['Admin', 'Merchant'],
    default: 'Merchant',
  },
  ipAddress: {
    type: String,
    default: '',
  },
  userAgent: {
    type: String,
    default: '',
  },
  device: {
    type: String,
    default: 'Desktop', // 'Mobile' | 'Desktop' | 'Tablet'
  },
  browser: {
    type: String,
    default: 'Unknown',
  },
  os: {
    type: String,
    default: 'Unknown',
  },
  loginMethod: {
    type: String,
    enum: ['PASSWORD', 'OTP', 'TOKEN_REFRESH'],
    default: 'PASSWORD',
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED'],
    default: 'SUCCESS',
  },
}, { timestamps: true });

loginLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('LoginLog', loginLogSchema);

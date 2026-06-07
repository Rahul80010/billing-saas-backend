const mongoose = require('mongoose');

const whatsappConnectionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
    unique: true, // Only one active connection per merchant user
  },
  businessId: {
    type: String,
    default: '',
  },
  wabaId: {
    type: String,
    required: true,
  },
  phoneNumberId: {
    type: String,
    required: true,
  },
  accessToken: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    default: '',
  },
  businessName: {
    type: String,
    default: '',
  },
  connectedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

module.exports = mongoose.model('WhatsAppConnection', whatsappConnectionSchema);

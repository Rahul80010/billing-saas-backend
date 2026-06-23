const mongoose = require('mongoose');

const recipientSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  phone: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['sent', 'failed'],
    default: 'sent',
  },
  error: {
    type: String,
    default: '',
  },
});

const campaignSchema = new mongoose.Schema({
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
  message: {
    type: String,
    required: true,
  },
  image: {
    type: String,
    default: '',
  },
  recipientsCount: {
    type: Number,
    required: true,
    default: 0,
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'completed',
  },
  recipients: [recipientSchema],
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema);

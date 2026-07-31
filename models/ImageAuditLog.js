const mongoose = require('mongoose');

const imageAuditLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  action: {
    type: String,
    enum: ['UPLOAD', 'REPLACE', 'DELETE', 'MIGRATE', 'CSV_IMPORT'],
    required: true,
  },
  imageKey: {
    type: String,
    default: '',
  },
  fileSize: {
    type: Number,
    default: 0,
  },
  mimeType: {
    type: String,
    default: 'image/webp',
  },
  ip: {
    type: String,
    default: '',
  },
  details: {
    type: String,
    default: '',
  },
}, { timestamps: true });

module.exports = mongoose.model('ImageAuditLog', imageAuditLogSchema);

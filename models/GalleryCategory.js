const mongoose = require('mongoose');

const galleryCategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true,
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  icon: {
    type: String,
    trim: true,
    default: 'Package',
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true,
  },
  displayOrder: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

module.exports = mongoose.model('GalleryCategory', galleryCategorySchema);

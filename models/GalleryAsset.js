const mongoose = require('mongoose');

const galleryAssetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  brand: {
    type: String,
    trim: true,
    default: '',
    index: true,
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GalleryCategory',
    default: null,
    index: true,
  },
  categoryName: {
    type: String,
    required: true,
    trim: true,
    index: true,
  },
  tags: {
    type: [String],
    default: [],
    index: true,
  },
  description: {
    type: String,
    trim: true,
    default: '',
  },
  imageUrl: {
    type: String,
    required: true,
    trim: true,
  },
  thumbnailUrl: {
    type: String,
    required: true,
    trim: true,
  },
  r2Key: {
    type: String,
    trim: true,
    default: '',
  },
  r2ThumbKey: {
    type: String,
    trim: true,
    default: '',
  },
  mimeType: {
    type: String,
    default: 'image/webp',
  },
  width: {
    type: Number,
    default: 800,
  },
  height: {
    type: Number,
    default: 800,
  },
  fileSize: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE'],
    default: 'ACTIVE',
    index: true,
  },
  usageCount: {
    type: Number,
    default: 0,
    index: true,
  },
  suggestedPrice: {
    type: Number,
    default: null,
  },
  suggestedUnit: {
    type: String,
    default: 'pcs',
  },
  suggestedGst: {
    type: Number,
    default: 0,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
}, { timestamps: true });

// Compound text index for fast keyword matching across name, brand, category, tags, and description
galleryAssetSchema.index({
  name: 'text',
  brand: 'text',
  categoryName: 'text',
  tags: 'text',
  description: 'text',
}, {
  weights: {
    name: 10,
    brand: 8,
    tags: 6,
    categoryName: 4,
    description: 2,
  },
  name: 'GalleryAssetTextIndex',
});

module.exports = mongoose.model('GalleryAsset', galleryAssetSchema);

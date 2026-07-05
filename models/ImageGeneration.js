const mongoose = require('mongoose');

const imageGenerationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  prompt: {
    type: String,
    required: true,
  },
  negativePrompt: {
    type: String,
    default: '',
  },
  style: {
    type: String,
    required: true,
  },
  aspectRatio: {
    type: String,
    required: true,
  },
  imageUrl: {
    type: String,
    required: true,
  },
  isFavorite: {
    type: Boolean,
    default: false,
  },
  upscaled: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('ImageGeneration', imageGenerationSchema);

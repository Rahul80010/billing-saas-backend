const express = require('express');
const router = express.Router();
const {
  generateImage,
  getGenerations,
  toggleFavorite,
  upscaleImage,
  deleteGeneration,
} = require('../controllers/imageGenerationController');
const { protect } = require('../middleware/authMiddleware');

// Protect all routes
router.use(protect);

router.route('/')
  .post(generateImage)
  .get(getGenerations);

router.put('/:id/favorite', toggleFavorite);
router.post('/:id/upscale', upscaleImage);
router.delete('/:id', deleteGeneration);

module.exports = router;

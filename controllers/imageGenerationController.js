const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ImageGeneration = require('../models/ImageGeneration');

// Helper to determine dimensions based on aspect ratio
const getDimensions = (aspectRatio, isUpscaled = false) => {
  const scale = isUpscaled ? 1.5 : 1;
  switch (aspectRatio) {
    case '16:9':
      return { width: Math.round(1024 * scale), height: Math.round(576 * scale) };
    case '9:16':
      return { width: Math.round(576 * scale), height: Math.round(1024 * scale) };
    case '4:5':
      return { width: Math.round(800 * scale), height: Math.round(1000 * scale) };
    case '1:1':
    default:
      return { width: Math.round(1024 * scale), height: Math.round(1024 * scale) };
  }
};

// Helper to get style prompt additions
const getStylePrompt = (style) => {
  switch (style) {
    case 'Realistic':
      return ', photorealistic, 8k resolution, highly detailed, sharp focus, lifelike textures, professional color grading';
    case 'Cinematic':
      return ', cinematic lighting, dramatic depth of field, blockbuster movie scene mood, highly detailed, 35mm film style';
    case 'Product Photography':
      return ', professional studio product photography, clean monochrome background, soft commercial lighting, crisp details, hyper-realistic';
    case 'Anime':
      return ', hand-drawn anime key art style, vibrant aesthetic colors, detailed background, cell shaded animation';
    case 'Illustration':
      return ', beautiful vector graphic illustration style, flat modern design, clean minimal vector strokes';
    case '3D Render':
      return ', digital 3D octane render, glossy clay texture, cute blender style model, highly detailed';
    case 'Minimal':
      return ', minimal art style, high contrast, clean shapes, simplistic composition, elegant';
    case 'Poster Design':
      return ', graphic poster style, bold vintage colors, aesthetic layout composition, screen printed style';
    case 'Social Media Creative':
      return ', eye-catching social media marketing creative design, high contrast graphic, trendy promotional display';
    default:
      return '';
  }
};

// @desc    Generate AI Image
// @route   POST /api/image-generations
// @access  Private
const generateImage = async (req, res) => {
  try {
    const { prompt, negativePrompt, style, aspectRatio } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    // Enhance prompt with style modifiers
    const enhancedPrompt = prompt.trim() + getStylePrompt(style);

    // Calculate dimensions
    const { width, height } = getDimensions(aspectRatio);

    // Encode prompt for URL
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    
    // Pollinations AI endpoint (Flux model)
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

    // Download image from Pollinations
    const response = await axios.get(pollinationsUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    // Setup local static directory
    const uploadsDir = path.join(__dirname, '../public/uploads/image-generations');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    // Write file to server public folder
    const filename = `${req.user.id}-${Date.now()}.png`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);

    // Save record to DB
    const newGeneration = await ImageGeneration.create({
      userId: req.user.id,
      prompt,
      negativePrompt: negativePrompt || '',
      style,
      aspectRatio,
      imageUrl: `/uploads/image-generations/${filename}`,
    });

    res.status(201).json(newGeneration);
  } catch (error) {
    console.error('Image Generation Error:', error);
    res.status(500).json({ message: 'Failed to generate AI image.' });
  }
};

// @desc    Get User Generation History
// @route   GET /api/image-generations
// @access  Private
const getGenerations = async (req, res) => {
  try {
    const history = await ImageGeneration.find({ userId: req.user.id })
      .sort({ createdAt: -1 });
    res.json(history);
  } catch (error) {
    console.error('Fetch History Error:', error);
    res.status(500).json({ message: 'Failed to load generation history.' });
  }
};

// @desc    Toggle Favorite Status
// @route   PUT /api/image-generations/:id/favorite
// @access  Private
const toggleFavorite = async (req, res) => {
  try {
    const generation = await ImageGeneration.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!generation) {
      return res.status(404).json({ message: 'Generation not found.' });
    }

    generation.isFavorite = !generation.isFavorite;
    await generation.save();

    res.json(generation);
  } catch (error) {
    console.error('Favorite Toggle Error:', error);
    res.status(500).json({ message: 'Failed to update favorite status.' });
  }
};

// @desc    Upscale Image (Simulate higher res request)
// @route   POST /api/image-generations/:id/upscale
// @access  Private
const upscaleImage = async (req, res) => {
  try {
    const generation = await ImageGeneration.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!generation) {
      return res.status(404).json({ message: 'Generation not found.' });
    }

    if (generation.upscaled) {
      return res.json(generation); // Already upscaled
    }

    // Enhance prompt with style modifiers
    const enhancedPrompt = generation.prompt.trim() + getStylePrompt(generation.style) + ', highly detailed textures, masterfully rendered';

    // Calculate dimensions at 1.5x scale
    const { width, height } = getDimensions(generation.aspectRatio, true);
    const encodedPrompt = encodeURIComponent(enhancedPrompt);
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

    const response = await axios.get(pollinationsUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');

    const uploadsDir = path.join(__dirname, '../public/uploads/image-generations');
    
    // Write new file
    const filename = `${req.user.id}-${Date.now()}-upscaled.png`;
    const filePath = path.join(uploadsDir, filename);
    fs.writeFileSync(filePath, buffer);

    // Delete old file
    if (generation.imageUrl && generation.imageUrl.startsWith('/uploads/')) {
      const oldFilePath = path.join(__dirname, '../public', generation.imageUrl);
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    // Update DB record
    generation.imageUrl = `/uploads/image-generations/${filename}`;
    generation.upscaled = true;
    await generation.save();

    res.json(generation);
  } catch (error) {
    console.error('Upscale Error:', error);
    res.status(500).json({ message: 'Failed to upscale image.' });
  }
};

// @desc    Delete Generated Image
// @route   DELETE /api/image-generations/:id
// @access  Private
const deleteGeneration = async (req, res) => {
  try {
    const generation = await ImageGeneration.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!generation) {
      return res.status(404).json({ message: 'Generation not found.' });
    }

    // Delete file from disk
    if (generation.imageUrl && generation.imageUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '../public', generation.imageUrl);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete from DB
    await ImageGeneration.deleteOne({ _id: generation._id });

    res.json({ success: true, id: generation._id });
  } catch (error) {
    console.error('Deletion Error:', error);
    res.status(500).json({ message: 'Failed to delete generated image.' });
  }
};

module.exports = {
  generateImage,
  getGenerations,
  toggleFavorite,
  upscaleImage,
  deleteGeneration,
};

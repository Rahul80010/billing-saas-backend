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
      return ', ultra-realistic photorealistic, 8k resolution, highly detailed textures, sharp focus, real life camera shot, professional studio color grading, dynamic lighting, award-winning photography';
    case 'Cinematic':
      return ', cinematic composition, beautiful dramatic lighting, intense depth of field, blockbuster movie screenshot, shot on anamorphic lens, highly detailed, atmospheric smoke and neon glare';
    case 'Product Photography':
      return ', professional commercial studio product photography, clean minimalist studio background, soft key lighting, commercial backlight, crisp reflection, sharp details, high contrast, perfect commercial poster composition';
    case 'Anime':
      return ', beautiful modern anime key art style, vibrant aesthetic neon colors, detailed custom backdrop scenery, highly polished illustration, desktop wallpaper design';
    case 'Illustration':
      return ', clean modern vector graphics illustration, minimalist style flat art, high contrast layout, aesthetic graphic design';
    case '3D Render':
      return ', digital 3D octane render, cute glossy blender style clay modeling, vivid pastel color scheme, highly detailed 3D model, isometric view';
    case 'Minimal':
      return ', elegant minimalist style art, high contrast shadows, clean geometry shape, simplistic composition, premium brand aesthetic';
    case 'Poster Design':
      return ', professional modern advertisement poster design, elegant typography layout, high contrast bold color palette, vector composition graphic, clean graphic design layout';
    case 'Social Media Creative':
      return ', eye-catching social media creative, high-converting banner advertisement graphic, professional brand marketing display layout, high contrast modern creative design';
    default:
      return '';
  }
};

// Helper to optimize prompt using Gemini 2.5 Flash
const getOptimizedPromptFromGemini = async (rawPrompt, style) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return rawPrompt;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const systemInstruction = `You are an expert AI prompt engineer for image generators (like Flux/Stable Diffusion).
Your task is to take a raw, unstructured user prompt (which may contain lists, bullet points, text requirements like "Shop Name: X", "Text: Y") and convert it into a SINGLE, cohesive, highly descriptive paragraph prompt.

Follow these rules:
1. Do NOT use bullet points, keys (like "Shop Name:"), or lists. Explain the entire visual scene in a continuous paragraph.
2. If there are text requirements (like shop names, slogans, labels), place them in double quotes and specify where they should be rendered (e.g. "a glowing neon sign on the wall reads 'Xiao Tech'", "the text 'Best Prices' is written in elegant white typography at the bottom of the poster").
3. Describe professional studio lighting (volumetric lighting, soft shadows), high-fidelity textures, professional color grading, and clean background space for overlays.
4. Keep the output focused purely on the final descriptive prompt paragraph. Do NOT add greetings, intro, or explanations. Only return the final prompt text.`;

    const response = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              {
                text: `${systemInstruction}\n\nUser Request: ${rawPrompt}\nArtistic Style: ${style}`
              }
            ]
          }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    if (response.data && response.data.candidates && response.data.candidates[0]) {
      const optimizedText = response.data.candidates[0].content.parts[0].text;
      if (optimizedText) {
        console.log('Optimized Prompt by Gemini:', optimizedText.trim());
        return optimizedText.trim();
      }
    }
  } catch (error) {
    console.error('Failed to optimize prompt via Gemini Flash:', error.message);
  }
  return rawPrompt;
};

// Helper to generate image buffer (Google Imagen 3 API with Pollinations Flux fallback)
const generateImageBuffer = async (enhancedPrompt, aspectRatio) => {
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      console.log('Generating image using Google Imagen 3 API...');
      
      // Map ratios to Imagen supported options ('1:1', '3:4', '4:3', '9:16', '16:9')
      let mappedRatio = '1:1';
      if (aspectRatio === '16:9' || aspectRatio === '21:9') mappedRatio = '16:9';
      else if (aspectRatio === '9:16') mappedRatio = '9:16';
      else if (aspectRatio === '4:5') mappedRatio = '3:4';
      
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;
      const response = await axios.post(
        endpoint,
        {
          instances: [
            {
              prompt: enhancedPrompt
            }
          ],
          parameters: {
            sampleCount: 1,
            aspectRatio: mappedRatio,
            outputMimeType: 'image/png'
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 25000 // 25s timeout
        }
      );

      if (response.data && response.data.predictions && response.data.predictions[0]) {
        const base64Data = response.data.predictions[0].bytesBase64Encoded;
        return Buffer.from(base64Data, 'base64');
      } else {
        throw new Error('Invalid response structure from Imagen API');
      }
    } catch (error) {
      console.error('Google Imagen API failed, falling back to Pollinations Flux:', error.response?.data || error.message);
    }
  }

  // Fallback / Default: Pollinations AI flux model
  console.log('Generating image using Pollinations Flux...');
  const { width, height } = getDimensions(aspectRatio);
  const encodedPrompt = encodeURIComponent(enhancedPrompt);
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=flux&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;

  const response = await axios.get(pollinationsUrl, { responseType: 'arraybuffer', timeout: 30000 });
  return Buffer.from(response.data, 'binary');
};

// @desc    Generate AI Image
// @route   POST /api/image-generations
// @access  Private
const generateImage = async (req, res) => {
  try {
    const { prompt, negativePrompt, style, aspectRatio, magicEnhance } = req.body;

    if (!prompt) {
      return res.status(400).json({ message: 'Prompt is required' });
    }

    // First optimize prompt using Gemini 2.5 Flash if possible
    const optimizedPrompt = await getOptimizedPromptFromGemini(prompt, style);

    // Enhance prompt with style modifiers
    let enhancedPrompt = optimizedPrompt.trim() + getStylePrompt(style);

    if (magicEnhance) {
      enhancedPrompt += ', professional marketing poster design composition, optimal layout for text placement, clean copy space, high-end branding visual, luxury advertising setup, crisp graphic design elements, sharp detailed textures';
    }

    // Generate image buffer (using Gemini Imagen 3 with Pollinations fallback)
    const buffer = await generateImageBuffer(enhancedPrompt, aspectRatio);

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

    // First optimize prompt using Gemini 2.5 Flash if possible
    const optimizedPrompt = await getOptimizedPromptFromGemini(generation.prompt, generation.style);

    // Enhance prompt with style modifiers
    const enhancedPrompt = optimizedPrompt.trim() + getStylePrompt(generation.style) + ', highly detailed textures, masterfully rendered';

    // Generate image buffer (using Gemini Imagen 3 with Pollinations fallback)
    const buffer = await generateImageBuffer(enhancedPrompt, generation.aspectRatio);

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

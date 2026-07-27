const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const { uploadBufferToStorage, deleteImageFromStorage } = require('../services/storageService');

/**
 * Helper to parse Base64 string to Buffer
 */
const parseBase64Image = (base64Str) => {
  if (!base64Str || typeof base64Str !== 'string') return null;

  const matches = base64Str.match(/^data:image\/([a-zA-Z0-9\+\-]+);base64,(.+)$/);
  if (matches) {
    const format = matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    return { format, buffer };
  } else if (!base64Str.startsWith('http://') && !base64Str.startsWith('https://')) {
    try {
      const buffer = Buffer.from(base64Str, 'base64');
      return { format: 'webp', buffer };
    } catch (_) {
      return null;
    }
  }
  return null;
};

/**
 * Create collision-free unique filename
 */
const generateUniqueFilename = (originalName = 'image', extension = 'webp') => {
  const cleanName = originalName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 30);
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const timestamp = Date.now();
  return `${cleanName}_${timestamp}_${randomSuffix}.${extension}`;
};

/**
 * @desc    Upload Single/Variant Product Image (Base64 or Binary Buffer)
 * @route   POST /api/upload/image
 * @access  Private
 */
const uploadImage = async (req, res) => {
  try {
    const { image, thumbnailImage, fileName, folder = 'products', width, height } = req.body;

    if (!image) {
      return res.status(400).json({ message: 'No image data provided.' });
    }

    // 1. Process original image buffer
    let origBuffer = null;
    let mimeType = 'image/webp';

    if (image.startsWith('data:') || !image.startsWith('http')) {
      const parsed = parseBase64Image(image);
      if (!parsed) {
        return res.status(400).json({ message: 'Invalid image payload format.' });
      }
      origBuffer = parsed.buffer;
    } else {
      // It's already a URL
      return res.json({ url: image, thumbnail: image, fileName: fileName || 'image.webp' });
    }

    // Check size limit (10MB max)
    if (origBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image size exceeds maximum 10MB limit.' });
    }

    // 2. Process thumbnail image buffer (if provided separately, otherwise reuse origBuffer)
    let thumbBuffer = origBuffer;
    if (thumbnailImage && (thumbnailImage.startsWith('data:') || !thumbnailImage.startsWith('http'))) {
      const parsedThumb = parseBase64Image(thumbnailImage);
      if (parsedThumb) {
        thumbBuffer = parsedThumb.buffer;
      }
    }

    // 3. Generate unique filenames & keys
    const uniqueFileName = generateUniqueFilename(fileName || 'prod');
    const origKey = `${folder}/${uniqueFileName}`;
    const thumbKey = `${folder}/thumb/${uniqueFileName}`;

    // 4. Upload both files to Cloudflare R2 / S3 Storage
    const [url, thumbnail] = await Promise.all([
      uploadBufferToStorage(origBuffer, origKey, mimeType),
      uploadBufferToStorage(thumbBuffer, thumbKey, mimeType)
    ]);

    // 5. Construct metadata response
    const metadata = {
      url,
      thumbnail: thumbnail || url,
      fileName: uniqueFileName,
      size: origBuffer.length,
      mimeType,
      width: width || 800,
      height: height || 800
    };

    res.status(201).json(metadata);
  } catch (error) {
    console.error('Failed to upload image to cloud storage:', error);
    res.status(500).json({ message: 'Image upload failed.', error: error.message });
  }
};

/**
 * @desc    Delete Image from Cloud Storage
 * @route   POST /api/upload/delete
 * @access  Private
 */
const deleteImage = async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ message: 'No image target provided.' });
    }

    await deleteImageFromStorage(image);
    res.json({ message: 'Image successfully deleted from cloud storage.' });
  } catch (error) {
    console.error('Failed to delete image:', error);
    res.status(500).json({ message: 'Failed to delete image.', error: error.message });
  }
};

/**
 * @desc    Safe, Resumable Migration Tool: Converts legacy Base64 MongoDB images to Cloud URLs
 * @route   POST /api/products/migrate-images
 * @access  Private
 */
const migrateBase64Images = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all products with Base64 image strings
    const products = await Product.find({
      userId,
      image: { $regex: /^data:image/i }
    });

    // Find all variants with Base64 image strings
    const variants = await ProductVariant.find({
      userId,
      image: { $regex: /^data:image/i }
    });

    let migratedProducts = 0;
    let migratedVariants = 0;

    // Migrate Products
    for (const prod of products) {
      if (typeof prod.image === 'string' && prod.image.startsWith('data:image')) {
        const parsed = parseBase64Image(prod.image);
        if (parsed) {
          const fileName = generateUniqueFilename(prod.name || 'product');
          const origKey = `products/${fileName}`;
          const thumbKey = `products/thumb/${fileName}`;

          const [url, thumbnail] = await Promise.all([
            uploadBufferToStorage(parsed.buffer, origKey, 'image/webp'),
            uploadBufferToStorage(parsed.buffer, thumbKey, 'image/webp')
          ]);

          prod.image = {
            url,
            thumbnail,
            fileName,
            size: parsed.buffer.length,
            mimeType: 'image/webp',
            width: 800,
            height: 800
          };

          await prod.save();
          migratedProducts++;
        }
      }
    }

    // Migrate Variants
    for (const varItem of variants) {
      if (typeof varItem.image === 'string' && varItem.image.startsWith('data:image')) {
        const parsed = parseBase64Image(varItem.image);
        if (parsed) {
          const fileName = generateUniqueFilename(varItem.variantName || 'variant');
          const origKey = `variants/${fileName}`;
          const thumbKey = `variants/thumb/${fileName}`;

          const [url, thumbnail] = await Promise.all([
            uploadBufferToStorage(parsed.buffer, origKey, 'image/webp'),
            uploadBufferToStorage(parsed.buffer, thumbKey, 'image/webp')
          ]);

          varItem.image = {
            url,
            thumbnail,
            fileName,
            size: parsed.buffer.length,
            mimeType: 'image/webp',
            width: 800,
            height: 800
          };

          await varItem.save();
          migratedVariants++;
        }
      }
    }

    res.json({
      message: 'Base64 image migration completed successfully.',
      migratedProducts,
      migratedVariants,
      totalRemainingBase64: (products.length - migratedProducts) + (variants.length - migratedVariants)
    });
  } catch (error) {
    console.error('Failed to run base64 image migration:', error);
    res.status(500).json({ message: 'Migration failed.', error: error.message });
  }
};

module.exports = {
  uploadImage,
  deleteImage,
  migrateBase64Images
};

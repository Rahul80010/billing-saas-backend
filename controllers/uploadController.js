const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const ImageAuditLog = require('../models/ImageAuditLog');
const axios = require('axios');
const { 
  uploadBufferToStorage, 
  deleteImageFromStorage, 
  generateUuidFilename, 
  getTenantKeyPath 
} = require('../services/storageService');

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
 * @desc    Upload Single/Variant Image (with automated WebP, tenant R2 path, UUID naming, and old image purging)
 * @route   POST /api/upload/image
 * @access  Private
 */
const uploadImage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { image, thumbnailImage, oldImage, folder = 'products', width, height } = req.body;

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
      return res.json({ url: image, thumbnail: image, fileName: 'image.webp' });
    }

    // Check size limit (10MB max)
    if (origBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image size exceeds maximum 10MB limit.' });
    }

    // 2. Process thumbnail image buffer
    let thumbBuffer = origBuffer;
    if (thumbnailImage && (thumbnailImage.startsWith('data:') || !thumbnailImage.startsWith('http'))) {
      const parsedThumb = parseBase64Image(thumbnailImage);
      if (parsedThumb) {
        thumbBuffer = parsedThumb.buffer;
      }
    }

    // 3. Generate secure UUID filename & tenant R2 key paths
    const uuidFile = generateUuidFilename('webp');
    const origKey = getTenantKeyPath(userId, folder, uuidFile, false);
    const thumbKey = getTenantKeyPath(userId, folder, uuidFile, true);

    // 4. If oldImage provided, purge old cloud image first
    if (oldImage) {
      try {
        await deleteImageFromStorage(oldImage);
      } catch (purgeErr) {
        console.error('Failed to purge old image on replace:', purgeErr.message);
      }
    }

    // 5. Upload original + thumbnail to Cloudflare R2 / S3
    const [url, thumbnail] = await Promise.all([
      uploadBufferToStorage(origBuffer, origKey, mimeType),
      uploadBufferToStorage(thumbBuffer, thumbKey, mimeType)
    ]);

    // 6. Construct metadata response
    const metadata = {
      url,
      thumbnail: thumbnail || url,
      fileName: uuidFile,
      size: origBuffer.length,
      mimeType,
      width: width || 800,
      height: height || 800
    };

    // 7. Audit Log Entry
    try {
      await ImageAuditLog.create({
        userId,
        action: oldImage ? 'REPLACE' : 'UPLOAD',
        imageKey: origKey,
        fileSize: origBuffer.length,
        mimeType,
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        details: `Uploaded image to folder ${folder}`
      });
    } catch (_) {}

    res.status(201).json(metadata);
  } catch (error) {
    console.error('Failed to upload image to cloud storage:', error);
    res.status(500).json({ message: 'Image upload failed.', error: error.message });
  }
};

/**
 * Helper to fetch image buffer from any URL, automatically handling webpage open-graph scraping and browser user agents.
 */
const fetchImageBufferFromAnyUrl = async (targetUrl) => {
  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  let response;
  try {
    response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 15 * 1024 * 1024,
      headers: browserHeaders
    });
  } catch (err) {
    throw new Error(`Could not fetch URL: ${err.message}`);
  }

  let buffer = Buffer.from(response.data);
  const contentType = (response.headers['content-type'] || '').toLowerCase();

  // Helper to check if buffer is an image by magic bytes
  const isImageBuffer = (b) => {
    if (!b || b.length < 4) return false;
    // JPEG (FF D8 FF)
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;
    // PNG (89 50 4E 47)
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true;
    // WebP (RIFF....WEBP)
    if (b.toString('utf8', 0, 4) === 'RIFF' && b.toString('utf8', 8, 12) === 'WEBP') return true;
    // GIF (GIF87a / GIF89a)
    if (b.toString('utf8', 0, 3) === 'GIF') return true;
    return false;
  };

  if (contentType.startsWith('image/') || isImageBuffer(buffer)) {
    return { buffer, mimeType: contentType.startsWith('image/') ? contentType : 'image/webp' };
  }

  // If it's a webpage HTML (e.g. Croma, Amazon, Flipkart, etc.), scrape the og:image or main image URL
  const html = buffer.toString('utf8');
  let extractedImageSrc = null;

  // Regex patterns to find product image URL in meta tags
  const ogMatch = html.match(/<meta\s+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["']\s+content=["']([^"']+)["']/i) ||
                  html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:og:image|twitter:image|twitter:image:src)["']/i) ||
                  html.match(/<link\s+rel=["']image_src["']\s+href=["']([^"']+)["']/i);

  if (ogMatch && ogMatch[1]) {
    extractedImageSrc = ogMatch[1].trim();
  } else {
    // Try finding img tag with src containing product / media
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+\.(?:png|jpg|jpeg|webp|gif)[^"']*)["']/i);
    if (imgMatch && imgMatch[1]) {
      extractedImageSrc = imgMatch[1].trim();
    }
  }

  if (!extractedImageSrc) {
    throw new Error('Webpage image not found. Please copy direct image link.');
  }

  // Resolve relative URL to absolute URL if needed
  try {
    extractedImageSrc = new URL(extractedImageSrc, targetUrl).href;
  } catch (_) {}

  // Now fetch the actual extracted image
  const imgResponse = await axios.get(extractedImageSrc, {
    responseType: 'arraybuffer',
    timeout: 15000,
    maxContentLength: 15 * 1024 * 1024,
    headers: browserHeaders
  });

  const imgBuffer = Buffer.from(imgResponse.data);
  const imgContentType = (imgResponse.headers['content-type'] || 'image/webp').toLowerCase();

  return { buffer: imgBuffer, mimeType: imgContentType };
};

/**
 * @desc    Upload Image from external URL (download → WebP → R2)
 * @route   POST /api/upload/image-url
 * @access  Private
 */
const uploadImageFromUrl = async (req, res) => {
  try {
    const userId = req.user._id;
    const { imageUrl, oldImage, folder = 'products' } = req.body;

    if (!imageUrl || typeof imageUrl !== 'string') {
      return res.status(400).json({ message: 'No image URL provided.' });
    }

    if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
      return res.status(400).json({ message: 'Invalid URL. Must start with http:// or https://' });
    }

    // Download image or scrape image from webpage URL automatically
    const { buffer, mimeType } = await fetchImageBufferFromAnyUrl(imageUrl.trim());

    // Check size
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image from URL exceeds 10MB limit.' });
    }

    // Generate UUID filename & tenant R2 paths
    const uuidFile = generateUuidFilename('webp');
    const origKey = getTenantKeyPath(userId, folder, uuidFile, false);
    const thumbKey = getTenantKeyPath(userId, folder, uuidFile, true);

    // Purge old image if replacing
    if (oldImage) {
      try {
        await deleteImageFromStorage(oldImage);
      } catch (purgeErr) {
        console.error('Failed to purge old image on URL replace:', purgeErr.message);
      }
    }

    // Upload original + thumbnail to R2
    const [url, thumbnail] = await Promise.all([
      uploadBufferToStorage(buffer, origKey, 'image/webp'),
      uploadBufferToStorage(buffer, thumbKey, 'image/webp')
    ]);

    const metadata = {
      url,
      thumbnail: thumbnail || url,
      fileName: uuidFile,
      size: buffer.length,
      mimeType: 'image/webp',
      width: 800,
      height: 800
    };

    // Audit Log
    try {
      await ImageAuditLog.create({
        userId,
        action: oldImage ? 'REPLACE' : 'UPLOAD',
        imageKey: origKey,
        fileSize: buffer.length,
        mimeType: 'image/webp',
        ip: req.ip || req.headers['x-forwarded-for'] || '',
        details: `Downloaded from URL and uploaded to ${folder}`
      });
    } catch (_) {}

    res.status(201).json(metadata);
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return res.status(408).json({ message: 'Image URL download timed out. Please try again.' });
    }
    if (error.response && error.response.status === 404) {
      return res.status(400).json({ message: 'Image not found at the provided URL.' });
    }
    console.error('Failed to upload image from URL:', error.message);
    res.status(400).json({ message: error.message || 'Failed to download and upload image from URL.' });
  }
};

/**
 * @desc    Delete Image from Cloud Storage
 * @route   POST /api/upload/delete
 * @access  Private
 */
const deleteImage = async (req, res) => {
  try {
    const userId = req.user._id;
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ message: 'No image target provided.' });
    }

    await deleteImageFromStorage(image);

    try {
      await ImageAuditLog.create({
        userId,
        action: 'DELETE',
        imageKey: typeof image === 'object' ? image.url : image,
        ip: req.ip || '',
        details: 'Deleted image from Cloudflare R2'
      });
    } catch (_) {}

    res.json({ message: 'Image successfully deleted from cloud storage.' });
  } catch (error) {
    console.error('Failed to delete image:', error);
    res.status(500).json({ message: 'Failed to delete image.', error: error.message });
  }
};

/**
 * @desc    Get Image Storage Dashboard Analytics
 * @route   GET /api/upload/stats
 * @access  Private
 */
const getStorageStats = async (req, res) => {
  try {
    const userId = req.user._id;

    const products = await Product.find({ userId }).lean();
    const variants = await ProductVariant.find({ userId }).lean();

    let totalImages = 0;
    let totalSizeBytes = 0;
    let productImagesCount = 0;
    let variantImagesCount = 0;
    let base64Products = 0;
    let base64Variants = 0;

    products.forEach(p => {
      if (p.image) {
        totalImages++;
        productImagesCount++;
        if (typeof p.image === 'string' && p.image.startsWith('data:image')) {
          base64Products++;
        } else if (typeof p.image === 'object' && p.image.size) {
          totalSizeBytes += p.image.size;
        }
      }
      if (Array.isArray(p.images)) {
        p.images.forEach(img => {
          totalImages++;
          productImagesCount++;
          if (typeof img === 'object' && img.size) {
            totalSizeBytes += img.size;
          }
        });
      }
    });

    variants.forEach(v => {
      if (v.image) {
        totalImages++;
        variantImagesCount++;
        if (typeof v.image === 'string' && v.image.startsWith('data:image')) {
          base64Variants++;
        } else if (typeof v.image === 'object' && v.image.size) {
          totalSizeBytes += v.image.size;
        }
      }
    });

    const recentLogs = await ImageAuditLog.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    res.json({
      totalImages,
      storageUsedMb: Number((totalSizeBytes / (1024 * 1024)).toFixed(2)),
      productImagesCount,
      variantImagesCount,
      remainingBase64Count: base64Products + base64Variants,
      recentAuditLogs: recentLogs
    });
  } catch (error) {
    console.error('Failed to fetch storage stats:', error);
    res.status(500).json({ message: 'Failed to fetch storage stats.', error: error.message });
  }
};

/**
 * @desc    Safe, Resumable Migration Tool: Converts legacy Base64 MongoDB images to Cloud URLs
 * @route   POST /api/upload/migrate
 * @access  Private (Admin / Tenant Owner)
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
          const uuidFile = generateUuidFilename('webp');
          const origKey = getTenantKeyPath(userId, 'products', uuidFile, false);
          const thumbKey = getTenantKeyPath(userId, 'products', uuidFile, true);

          const [url, thumbnail] = await Promise.all([
            uploadBufferToStorage(parsed.buffer, origKey, 'image/webp'),
            uploadBufferToStorage(parsed.buffer, thumbKey, 'image/webp')
          ]);

          prod.image = {
            url,
            thumbnail,
            fileName: uuidFile,
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
          const uuidFile = generateUuidFilename('webp');
          const origKey = getTenantKeyPath(userId, 'variants', uuidFile, false);
          const thumbKey = getTenantKeyPath(userId, 'variants', uuidFile, true);

          const [url, thumbnail] = await Promise.all([
            uploadBufferToStorage(parsed.buffer, origKey, 'image/webp'),
            uploadBufferToStorage(parsed.buffer, thumbKey, 'image/webp')
          ]);

          varItem.image = {
            url,
            thumbnail,
            fileName: uuidFile,
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

    try {
      await ImageAuditLog.create({
        userId,
        action: 'MIGRATE',
        details: `Migrated ${migratedProducts} products and ${migratedVariants} variants to Cloud Storage`
      });
    } catch (_) {}

    res.json({
      message: 'Base64 image migration completed successfully.',
      migratedProducts,
      migratedVariants,
      remainingBase64Count: (products.length - migratedProducts) + (variants.length - migratedVariants)
    });
  } catch (error) {
    console.error('Failed to run base64 image migration:', error);
    res.status(500).json({ message: 'Migration failed.', error: error.message });
  }
};

module.exports = {
  uploadImage,
  uploadImageFromUrl,
  deleteImage,
  getStorageStats,
  migrateBase64Images,
  fetchImageBufferFromAnyUrl
};

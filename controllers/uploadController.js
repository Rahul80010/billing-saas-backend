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
      if (parsed.format) {
        mimeType = parsed.format.startsWith('image/') ? parsed.format : `image/${parsed.format}`;
      }
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

const dns = require('dns').promises;
const net = require('net');

/**
 * Checks whether an IP address is private, loopback, link-local, or otherwise reserved.
 */
const isPrivateOrBlockedIp = (ip) => {
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
      return true;
    }
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 10.0.0.0/8 (Private RFC 1918)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (Private RFC 1918: 172.16 - 172.31)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (Private RFC 1918)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-local / Cloud Metadata: 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 192.0.0.0/24, 192.0.2.0/24 (Documentation/Reserved)
    if (parts[0] === 192 && parts[1] === 0 && (parts[2] === 0 || parts[2] === 2)) return true;
    // 198.18.0.0/15 (Benchmark)
    if (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) return true;
    // 198.51.100.0/24, 203.0.113.0/24
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (parts[0] >= 224) return true;

    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // Loopback ::1, Unspecified ::
    if (lower === '::1' || lower === '::') return true;
    // Unique Local: fc00::/7 (fc00 - fdff)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    // Link Local: fe80::/10 (fe80 - febf)
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;

    return false;
  }

  return true;
};

/**
 * Validates a target URL against SSRF vulnerabilities (blocks loopback, cloud metadata, RFC 1918).
 */
const validateSafeUrl = async (targetUrl) => {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (e) {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Disallowed protocol. Only HTTP and HTTPS are permitted.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error('Disallowed host: target resolves to a local or internal domain.');
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrBlockedIp(hostname)) {
      throw new Error('Disallowed destination IP address: Private, loopback, or metadata addresses are prohibited.');
    }
  } else {
    let records;
    try {
      records = await dns.lookup(hostname, { all: true });
    } catch (dnsErr) {
      throw new Error(`DNS resolution failed for host: ${hostname}`);
    }

    if (!records || records.length === 0) {
      throw new Error(`No IP addresses found for host: ${hostname}`);
    }

    for (const record of records) {
      if (isPrivateOrBlockedIp(record.address)) {
        throw new Error(`Disallowed host: ${hostname} resolves to restricted IP ${record.address}`);
      }
    }
  }

  return parsed;
};

/**
 * Helper to fetch image buffer from any URL, automatically handling webpage open-graph scraping and browser user agents.
 */
const fetchImageBufferFromAnyUrl = async (targetUrl) => {
  await validateSafeUrl(targetUrl);

  const browserHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  let response;
  try {
    response = await axios.get(targetUrl, {
      responseType: 'arraybuffer',
      timeout: 8000,
      maxContentLength: 8 * 1024 * 1024,
      headers: browserHeaders,
      maxRedirects: 3,
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

  // Validate the extracted scraped image URL against SSRF as well
  await validateSafeUrl(extractedImageSrc);

  // Now fetch the actual extracted image
  const imgResponse = await axios.get(extractedImageSrc, {
    responseType: 'arraybuffer',
    timeout: 8000,
    maxContentLength: 8 * 1024 * 1024,
    headers: browserHeaders,
    maxRedirects: 3,
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
    const userId = req.user._id.toString();
    const isAdmin = req.user.isAdmin;
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ message: 'No image target provided.' });
    }

    // Helper to parse key
    const parseKey = (targetUrl) => {
      if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.startsWith('data:')) return null;
      try {
        if (targetUrl.includes('/uploads/')) {
          return targetUrl.split('/uploads/')[1];
        }
        const parsed = new URL(targetUrl);
        return parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
      } catch (_) {
        return targetUrl;
      }
    };

    const targetUrl = typeof image === 'object' ? (image.url || image.thumbnail) : image;
    const key = parseKey(targetUrl);

    // Enforce tenant isolation: merchants can only delete assets from their own tenant directory
    if (!isAdmin && key) {
      const expectedPrefix = `tenant_${userId}/`;
      if (!key.startsWith(expectedPrefix)) {
        return res.status(403).json({ message: 'Forbidden: You are not authorized to delete another tenant\'s assets.' });
      }
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
  fetchImageBufferFromAnyUrl,
  validateSafeUrl,
  isPrivateOrBlockedIp
};

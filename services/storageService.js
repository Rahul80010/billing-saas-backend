const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// Initialize S3Client for Cloudflare R2 / AWS S3 if credentials exist
const getS3Client = () => {
  const accountId = process.env.R2_ACCOUNT_ID || process.env.AWS_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : process.env.AWS_S3_ENDPOINT);

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: process.env.R2_REGION || process.env.AWS_REGION || 'auto',
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

const getBucketName = () => {
  return process.env.R2_BUCKET_NAME || process.env.AWS_S3_BUCKET_NAME || 'mohuri-uploads';
};

const getPublicCdnDomain = () => {
  const publicDomain = process.env.R2_PUBLIC_DOMAIN || process.env.AWS_S3_PUBLIC_DOMAIN;
  if (publicDomain) {
    return publicDomain.endsWith('/') ? publicDomain.slice(0, -1) : publicDomain;
  }
  const accountId = process.env.R2_ACCOUNT_ID;
  const bucketName = getBucketName();
  if (accountId && bucketName) {
    return `https://${bucketName}.${accountId}.r2.dev`;
  }
  return '';
};

/**
 * Generate secure UUID collision-free filename
 */
const generateUuidFilename = (extension = 'webp') => {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${uuid}.${extension}`;
};

/**
 * Build tenant-isolated key path
 * Example: tenant_664a123/products/5f7c3a11-b9dd-4fa7-a2db.webp
 */
const getTenantKeyPath = (tenantId, folder = 'products', filename = '', isThumb = false) => {
  const cleanTenant = (tenantId || 'global').toString().replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanFolder = (folder || 'products').toString().replace(/[^a-zA-Z0-9_-]/g, '');
  const finalFile = filename || generateUuidFilename('webp');

  if (isThumb) {
    return `tenant_${cleanTenant}/${cleanFolder}/thumb/${finalFile}`;
  }
  return `tenant_${cleanTenant}/${cleanFolder}/${finalFile}`;
};

/**
 * Build centralized Mohuri Gallery key path (e.g. mohuri-gallery/grocery/uuid.webp)
 */
const getGalleryKeyPath = (category = 'general', filename = '', isThumb = false) => {
  const cleanCat = (category || 'general').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const finalFile = filename || generateUuidFilename('webp');

  if (isThumb) {
    return `mohuri-gallery/${cleanCat}/thumb/${finalFile}`;
  }
  return `mohuri-gallery/${cleanCat}/${finalFile}`;
};

/**
 * Upload a WebP buffer to Cloudflare R2 / S3 or Local Fallback
 * @param {Buffer} buffer - WebP binary image buffer
 * @param {string} keyPath - Object key path (e.g. tenant_123/products/uuid.webp)
 * @param {string} mimeType - Content MIME type (default 'image/webp')
 * @returns {Promise<string>} Public CDN URL of uploaded image
 */
const uploadBufferToStorage = async (buffer, keyPath, mimeType = 'image/webp') => {
  const s3Client = getS3Client();
  const bucketName = getBucketName();

  if (s3Client && bucketName) {
    try {
      // Upload to Cloudflare R2 / S3 with CDN Caching Header
      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: keyPath,
        Body: buffer,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      });

      await s3Client.send(command);

      const cdnDomain = getPublicCdnDomain();
      if (cdnDomain) {
        return `${cdnDomain}/${keyPath}`;
      }
      return `https://${bucketName}.r2.cloudflarestorage.com/${keyPath}`;
    } catch (s3Error) {
      console.error('❌ Cloudflare R2 Upload Command Failed:', s3Error.message);
      throw new Error(`Cloudflare R2 Storage Error: ${s3Error.message}`);
    }
  } else {
    console.warn('⚠️ Cloudflare R2 credentials missing in environment! Falling back to local disk storage.');
    // Fallback to local server disk storage
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const targetFile = path.join(uploadsDir, keyPath);
    const targetFolder = path.dirname(targetFile);

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    fs.writeFileSync(targetFile, buffer);

    const serverDomain = process.env.SERVER_URL || 
                         process.env.PUBLIC_SERVER_URL || 
                         (process.env.RAILWAY_STATIC_URL ? `https://${process.env.RAILWAY_STATIC_URL}` : null) || 
                         'https://billing-saas-backend-production-3119.up.railway.app';
    return `${serverDomain}/uploads/${keyPath.replace(/\\/g, '/')}`;
  }
};

/**
 * Delete image and its thumbnail from Cloudflare R2 / S3 or Local storage
 * @param {string|object} imageField - String URL or Metadata object
 */
const deleteImageFromStorage = async (imageField) => {
  if (!imageField) return;

  const extractUrl = (item) => {
    if (!item) return '';
    if (typeof item === 'string') return item;
    if (typeof item === 'object') return item.url || item.thumbnail || '';
    return '';
  };

  const extractThumbUrl = (item) => {
    if (typeof item === 'object' && item.thumbnail) return item.thumbnail;
    return '';
  };

  // Support array of images or single image
  const targets = Array.isArray(imageField) ? imageField : [imageField];

  const keysToDelete = [];

  for (const tgt of targets) {
    const url = extractUrl(tgt);
    const thumbUrl = extractThumbUrl(tgt);

    const parseKey = (targetUrl) => {
      if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.startsWith('data:')) return null;
      try {
        if (targetUrl.includes('/uploads/')) {
          return targetUrl.split('/uploads/')[1];
        }
        const parsed = new URL(targetUrl);
        return parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
      } catch (_) {
        return null;
      }
    };

    const k1 = parseKey(url);
    const k2 = parseKey(thumbUrl);

    if (k1) keysToDelete.push(k1);
    if (k2 && k2 !== k1) keysToDelete.push(k2);
  }

  const s3Client = getS3Client();
  const bucketName = getBucketName();

  for (const key of keysToDelete) {
    if (s3Client && bucketName) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
      } catch (err) {
        console.error(`Failed to delete S3 key ${key}:`, err.message);
      }
    } else {
      try {
        const localPath = path.join(__dirname, '..', 'uploads', key);
        if (fs.existsSync(localPath)) {
          fs.unlinkSync(localPath);
        }
      } catch (err) {
        console.error(`Failed to delete local file ${key}:`, err.message);
      }
    }
  }
};

module.exports = {
  uploadBufferToStorage,
  deleteImageFromStorage,
  getPublicCdnDomain,
  generateUuidFilename,
  getTenantKeyPath,
  getGalleryKeyPath,
};

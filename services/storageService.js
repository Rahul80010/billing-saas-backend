const fs = require('fs');
const path = require('path');
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
 * Upload a WebP buffer to Cloudflare R2 / S3 or Local Fallback
 * @param {Buffer} buffer - WebP binary image buffer
 * @param {string} keyPath - Object key path (e.g., 'products/iphone15_1785.webp' or 'products/thumb/iphone15_1785.webp')
 * @param {string} mimeType - Content MIME type (default 'image/webp')
 * @returns {Promise<string>} Public URL of uploaded image
 */
const uploadBufferToStorage = async (buffer, keyPath, mimeType = 'image/webp') => {
  const s3Client = getS3Client();
  const bucketName = getBucketName();

  if (s3Client && bucketName) {
    // Upload to Cloudflare R2 / S3
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
  } else {
    // Fallback to local server disk storage
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const targetFile = path.join(uploadsDir, keyPath);
    const targetFolder = path.dirname(targetFile);

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }

    fs.writeFileSync(targetFile, buffer);

    const serverDomain = process.env.SERVER_URL || 'http://localhost:5000';
    return `${serverDomain}/uploads/${keyPath.replace(/\\/g, '/')}`;
  }
};

/**
 * Delete image and its thumbnail from Cloudflare R2 / S3 or Local storage
 * @param {string|object} imageField - String URL or Metadata object
 */
const deleteImageFromStorage = async (imageField) => {
  if (!imageField) return;

  const url = typeof imageField === 'object' ? imageField.url : imageField;
  const thumbUrl = typeof imageField === 'object' ? imageField.thumbnail : '';

  if (!url || typeof url !== 'string' || url.startsWith('data:')) return;

  const deleteKey = (targetUrl) => {
    if (!targetUrl || typeof targetUrl !== 'string') return null;
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

  const keysToDelete = [deleteKey(url), deleteKey(thumbUrl)].filter(Boolean);

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
};

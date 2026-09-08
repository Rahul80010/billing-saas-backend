const GalleryAsset = require('../models/GalleryAsset');
const GalleryCategory = require('../models/GalleryCategory');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const {
  uploadBufferToStorage,
  deleteImageFromStorage,
  generateUuidFilename,
  getGalleryKeyPath,
} = require('../services/storageService');

// Helper to escape regex special characters
const escapeRegex = (text) => {
  return (text || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
};

// Helper to parse Base64 string to Buffer
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

// Default seed categories
const DEFAULT_CATEGORIES = [
  { name: 'Grocery & Staples', slug: 'grocery-staples', icon: 'ShoppingBag', displayOrder: 1 },
  { name: 'Beverages & Cold Drinks', slug: 'beverages-cold-drinks', icon: 'Coffee', displayOrder: 2 },
  { name: 'Snacks & Packaged Food', slug: 'snacks-packaged-food', icon: 'Cookie', displayOrder: 3 },
  { name: 'Dairy & Bakery', slug: 'dairy-bakery', icon: 'Milk', displayOrder: 4 },
  { name: 'Personal Care & Beauty', slug: 'personal-care-beauty', icon: 'Sparkles', displayOrder: 5 },
  { name: 'Mobile Phones & Tablets', slug: 'mobile-phones-tablets', icon: 'Smartphone', displayOrder: 6 },
  { name: 'Electronics & Gadgets', slug: 'electronics-gadgets', icon: 'Tv', displayOrder: 7 },
  { name: 'Clothing & Fashion', slug: 'clothing-fashion', icon: 'Shirt', displayOrder: 8 },
  { name: 'Restaurant & Fast Food', slug: 'restaurant-fast-food', icon: 'Utensils', displayOrder: 9 },
  { name: 'Pharmacy & Health', slug: 'pharmacy-health', icon: 'Cross', displayOrder: 10 },
  { name: 'Hardware & Electricals', slug: 'hardware-electricals', icon: 'Wrench', displayOrder: 11 },
  { name: 'Stationery & Office', slug: 'stationery-office', icon: 'BookOpen', displayOrder: 12 },
  { name: 'Home & Kitchen', slug: 'home-kitchen', icon: 'Home', displayOrder: 13 },
  { name: 'General & Others', slug: 'general-others', icon: 'Package', displayOrder: 14 },
];

/**
 * Ensure default categories exist in DB
 */
const ensureDefaultCategories = async () => {
  const count = await GalleryCategory.countDocuments();
  if (count === 0) {
    await GalleryCategory.insertMany(DEFAULT_CATEGORIES);
  }
};

/**
 * @desc    Get paginated, searchable list of active gallery assets (Merchant & Admin)
 * @route   GET /api/gallery
 * @access  Private (Authenticated users)
 */
const getGalleryAssets = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 24, 60);
    const skip = (page - 1) * limit;

    const search = (req.query.search || '').trim();
    const category = (req.query.category || '').trim();
    const brand = (req.query.brand || '').trim();
    const requestedStatus = req.query.status;

    // Normal users ONLY see ACTIVE assets; Admins can filter status
    const isAdminUser = req.user && req.user.isAdmin;
    const query = {};

    if (!isAdminUser || !requestedStatus || requestedStatus === 'ACTIVE') {
      query.status = 'ACTIVE';
    } else if (requestedStatus === 'INACTIVE') {
      query.status = 'INACTIVE';
    } // If 'ALL' and isAdmin, no status filter

    if (category && category.toLowerCase() !== 'all') {
      query.categoryName = { $regex: new RegExp(`^${escapeRegex(category)}$`, 'i') };
    }

    if (brand) {
      query.brand = { $regex: new RegExp(escapeRegex(brand), 'i') };
    }

    if (search) {
      const cleanTerm = escapeRegex(search);
      const regex = new RegExp(cleanTerm, 'i');
      query.$or = [
        { name: regex },
        { brand: regex },
        { categoryName: regex },
        { tags: regex },
        { description: regex },
      ];
    }

    const total = await GalleryAsset.countDocuments(query);
    const assets = await GalleryAsset.find(query)
      .sort({ usageCount: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      assets,
      page,
      pages: Math.ceil(total / limit) || 1,
      total,
    });
  } catch (error) {
    console.error('Failed to get gallery assets:', error);
    res.status(500).json({ message: 'Failed to fetch gallery assets', error: error.message });
  }
};

/**
 * @desc    Get all active gallery categories with live asset counts
 * @route   GET /api/gallery/categories
 * @access  Private (Authenticated users)
 */
const getGalleryCategories = async (req, res) => {
  try {
    await ensureDefaultCategories();

    const categories = await GalleryCategory.find({ isActive: true })
      .sort({ displayOrder: 1, name: 1 })
      .lean();

    // Aggregate active assets count for each category
    const counts = await GalleryAsset.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $group: { _id: '$categoryName', count: { $sum: 1 } } }
    ]);

    const countMap = {};
    counts.forEach(c => {
      if (c._id) {
        countMap[c._id.toLowerCase()] = c.count;
      }
    });

    const categoriesWithCount = categories.map(cat => ({
      ...cat,
      assetCount: countMap[cat.name.toLowerCase()] || 0
    }));

    res.json({
      categories: categoriesWithCount
    });
  } catch (error) {
    console.error('Failed to get gallery categories:', error);
    res.status(500).json({ message: 'Failed to fetch categories', error: error.message });
  }
};

/**
 * @desc    Get single gallery asset by ID
 * @route   GET /api/gallery/:id
 * @access  Private
 */
const getGalleryAssetById = async (req, res) => {
  try {
    const asset = await GalleryAsset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ message: 'Gallery asset not found' });
    }
    res.json(asset);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch asset', error: error.message });
  }
};

/**
 * @desc    Record usage reference of gallery asset when merchant selects it
 * @route   POST /api/gallery/usage/:id
 * @access  Private
 */
const recordAssetUsage = async (req, res) => {
  try {
    const asset = await GalleryAsset.findByIdAndUpdate(
      req.params.id,
      { $inc: { usageCount: 1 } },
      { new: true }
    );
    if (!asset) {
      return res.status(404).json({ message: 'Asset not found' });
    }
    res.json({ message: 'Usage recorded', usageCount: asset.usageCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to record asset usage', error: error.message });
  }
};

/**
 * @desc    Upload new asset to Mohuri Gallery (Admin Only)
 * @route   POST /api/admin/gallery
 * @access  Private/Admin
 */
const uploadGalleryAsset = async (req, res) => {
  try {
    const {
      name,
      categoryName,
      categoryId,
      brand,
      tags,
      description,
      suggestedPrice,
      suggestedUnit,
      suggestedGst,
      image,
      thumbnailImage,
      width,
      height,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Product/Image name is required' });
    }
    if (!categoryName || !categoryName.trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }
    if (!image) {
      return res.status(400).json({ message: 'Image data is required' });
    }

    // 1. Process original image buffer
    let origBuffer = null;
    let mimeType = 'image/webp';

    if (image.startsWith('data:') || !image.startsWith('http')) {
      const parsed = parseBase64Image(image);
      if (!parsed) {
        return res.status(400).json({ message: 'Invalid image format provided.' });
      }
      origBuffer = parsed.buffer;
      if (parsed.format) {
        mimeType = parsed.format.startsWith('image/') ? parsed.format : `image/${parsed.format}`;
      }
    } else {
      return res.status(400).json({ message: 'Image must be uploaded as WebP/Base64 binary data.' });
    }

    if (origBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Image exceeds maximum 10MB limit.' });
    }

    // 2. Process thumbnail buffer
    let thumbBuffer = origBuffer;
    if (thumbnailImage && (thumbnailImage.startsWith('data:') || !thumbnailImage.startsWith('http'))) {
      const parsedThumb = parseBase64Image(thumbnailImage);
      if (parsedThumb) {
        thumbBuffer = parsedThumb.buffer;
      }
    }

    // 3. Generate key paths for Cloudflare R2
    const uuidFile = generateUuidFilename('webp');
    const origKey = getGalleryKeyPath(categoryName.trim(), uuidFile, false);
    const thumbKey = getGalleryKeyPath(categoryName.trim(), uuidFile, true);

    // 4. Upload original + thumbnail to Cloudflare R2 / S3
    const [imageUrl, thumbnailUrl] = await Promise.all([
      uploadBufferToStorage(origBuffer, origKey, mimeType),
      uploadBufferToStorage(thumbBuffer, thumbKey, mimeType)
    ]);

    // 5. Parse tags
    let cleanTags = [];
    if (Array.isArray(tags)) {
      cleanTags = tags.map(t => (t || '').toString().trim().toLowerCase()).filter(Boolean);
    } else if (typeof tags === 'string') {
      cleanTags = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    }

    // Automatically add name words and brand to tags for optimal discovery
    const nameWords = name.trim().toLowerCase().split(/\s+/);
    cleanTags = Array.from(new Set([...cleanTags, ...nameWords, (brand || '').trim().toLowerCase()])).filter(Boolean);

    // 6. Save in GalleryCategory if category does not exist yet
    let catDoc = null;
    if (categoryId) {
      catDoc = await GalleryCategory.findById(categoryId);
    }
    if (!catDoc && categoryName) {
      const slug = categoryName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      catDoc = await GalleryCategory.findOneAndUpdate(
        { name: categoryName.trim() },
        { name: categoryName.trim(), slug },
        { upsert: true, new: true }
      );
    }

    // 7. Create GalleryAsset in MongoDB
    const asset = await GalleryAsset.create({
      name: name.trim(),
      brand: (brand || '').trim(),
      categoryId: catDoc ? catDoc._id : null,
      categoryName: categoryName.trim(),
      tags: cleanTags,
      description: (description || '').trim(),
      imageUrl,
      thumbnailUrl: thumbnailUrl || imageUrl,
      r2Key: origKey,
      r2ThumbKey: thumbKey,
      mimeType,
      width: width || 800,
      height: height || 800,
      fileSize: origBuffer.length,
      status: 'ACTIVE',
      suggestedPrice: suggestedPrice !== undefined && suggestedPrice !== null && suggestedPrice !== '' ? Number(suggestedPrice) : null,
      suggestedUnit: suggestedUnit || 'pcs',
      suggestedGst: suggestedGst !== undefined && suggestedGst !== null && suggestedGst !== '' ? Number(suggestedGst) : 0,
      uploadedBy: req.user._id,
    });

    res.status(201).json({
      message: 'Image successfully uploaded to MOHURI Gallery',
      asset,
    });
  } catch (error) {
    console.error('Failed to upload gallery asset:', error);
    res.status(500).json({ message: 'Failed to upload image to gallery', error: error.message });
  }
};

/**
 * @desc    Update gallery asset metadata (Admin Only)
 * @route   PUT /api/admin/gallery/:id
 * @access  Private/Admin
 */
const updateGalleryAsset = async (req, res) => {
  try {
    const {
      name,
      categoryName,
      brand,
      tags,
      description,
      suggestedPrice,
      suggestedUnit,
      suggestedGst,
      status,
    } = req.body;

    const asset = await GalleryAsset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ message: 'Gallery asset not found' });
    }

    if (name) asset.name = name.trim();
    if (categoryName) asset.categoryName = categoryName.trim();
    if (brand !== undefined) asset.brand = (brand || '').trim();
    if (description !== undefined) asset.description = (description || '').trim();
    if (status && ['ACTIVE', 'INACTIVE'].includes(status)) asset.status = status;

    if (suggestedPrice !== undefined) {
      asset.suggestedPrice = suggestedPrice !== null && suggestedPrice !== '' ? Number(suggestedPrice) : null;
    }
    if (suggestedUnit !== undefined) asset.suggestedUnit = suggestedUnit || 'pcs';
    if (suggestedGst !== undefined) asset.suggestedGst = Number(suggestedGst) || 0;

    if (tags !== undefined) {
      if (Array.isArray(tags)) {
        asset.tags = tags.map(t => (t || '').toString().trim().toLowerCase()).filter(Boolean);
      } else if (typeof tags === 'string') {
        asset.tags = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      }
    }

    await asset.save();
    res.json({ message: 'Gallery asset updated successfully', asset });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update asset', error: error.message });
  }
};

/**
 * @desc    Toggle status between ACTIVE and INACTIVE (Admin Only)
 * @route   PATCH /api/admin/gallery/:id/status
 * @access  Private/Admin
 */
const toggleAssetStatus = async (req, res) => {
  try {
    const asset = await GalleryAsset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ message: 'Gallery asset not found' });
    }

    asset.status = asset.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await asset.save();

    res.json({
      message: `Asset marked as ${asset.status}`,
      status: asset.status,
      asset,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to toggle status', error: error.message });
  }
};

/**
 * @desc    Safe delete gallery asset (Admin Only)
 * @route   DELETE /api/admin/gallery/:id
 * @access  Private/Admin
 */
const deleteGalleryAsset = async (req, res) => {
  try {
    const asset = await GalleryAsset.findById(req.params.id);
    if (!asset) {
      return res.status(404).json({ message: 'Gallery asset not found' });
    }

    // Check if any merchant product or variant is currently using this asset
    const productUsageCount = await Product.countDocuments({
      $or: [
        { 'image.galleryAssetId': asset._id },
        { 'image.url': asset.imageUrl },
        { image: asset.imageUrl },
      ],
    });

    const variantUsageCount = await ProductVariant.countDocuments({
      $or: [
        { 'image.galleryAssetId': asset._id },
        { 'image.url': asset.imageUrl },
        { image: asset.imageUrl },
      ],
    });

    const totalInUse = productUsageCount + variantUsageCount;
    const forceDelete = req.query.force === 'true';

    // If referenced and not forcing, prevent hard delete
    if (totalInUse > 0 && !forceDelete) {
      return res.status(409).json({
        inUse: true,
        inUseCount: totalInUse,
        message: `This image is currently being used by ${totalInUse} product(s) or variant(s). Deleting it will break their product photos. We recommend deactivating it instead.`,
      });
    }

    // If safe to delete or forced:
    // Delete files from Cloudflare R2
    try {
      await deleteImageFromStorage([asset.imageUrl, asset.thumbnailUrl]);
    } catch (r2Err) {
      console.error('Failed to delete R2 objects on gallery asset deletion:', r2Err.message);
    }

    await GalleryAsset.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Gallery asset deleted successfully from library and storage.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete asset', error: error.message });
  }
};

/**
 * @desc    Get Admin Gallery Dashboard Statistics
 * @route   GET /api/admin/gallery/stats
 * @access  Private/Admin
 */
const getGalleryStats = async (req, res) => {
  try {
    const totalAssets = await GalleryAsset.countDocuments();
    const activeAssets = await GalleryAsset.countDocuments({ status: 'ACTIVE' });
    const inactiveAssets = await GalleryAsset.countDocuments({ status: 'INACTIVE' });
    const totalCategories = await GalleryCategory.countDocuments({ isActive: true });

    // Most used assets across all merchants
    const mostUsedAssets = await GalleryAsset.find({ status: 'ACTIVE' })
      .sort({ usageCount: -1 })
      .limit(6)
      .lean();

    res.json({
      totalAssets,
      activeAssets,
      inactiveAssets,
      totalCategories,
      mostUsedAssets,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch gallery stats', error: error.message });
  }
};

/**
 * @desc    Create new category (Admin Only)
 * @route   POST /api/admin/gallery/categories
 * @access  Private/Admin
 */
const createCategory = async (req, res) => {
  try {
    const { name, description, icon } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const existing = await GalleryCategory.findOne({
      $or: [{ name: name.trim() }, { slug }]
    });

    if (existing) {
      return res.status(400).json({ message: 'Category with this name already exists' });
    }

    const category = await GalleryCategory.create({
      name: name.trim(),
      slug,
      description: (description || '').trim(),
      icon: icon || 'Package',
      isActive: true,
      displayOrder: (await GalleryCategory.countDocuments()) + 1,
    });

    res.status(201).json({ message: 'Category created successfully', category });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create category', error: error.message });
  }
};

/**
 * @desc    Update category (Admin Only)
 * @route   PUT /api/admin/gallery/categories/:id
 * @access  Private/Admin
 */
const updateCategory = async (req, res) => {
  try {
    const { name, description, icon, isActive } = req.body;
    const category = await GalleryCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const oldName = category.name;
    if (name) {
      category.name = name.trim();
      category.slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    if (description !== undefined) category.description = (description || '').trim();
    if (icon) category.icon = icon;
    if (typeof isActive === 'boolean') category.isActive = isActive;

    await category.save();

    // If category name changed, update all existing assets in that category
    if (name && name.trim() !== oldName) {
      await GalleryAsset.updateMany(
        { categoryName: oldName },
        { $set: { categoryName: name.trim() } }
      );
    }

    res.json({ message: 'Category updated successfully', category });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update category', error: error.message });
  }
};

/**
 * @desc    Delete / Deactivate category (Admin Only)
 * @route   DELETE /api/admin/gallery/categories/:id
 * @access  Private/Admin
 */
const deleteCategory = async (req, res) => {
  try {
    const category = await GalleryCategory.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const assetCount = await GalleryAsset.countDocuments({
      $or: [{ categoryId: category._id }, { categoryName: category.name }],
    });

    if (assetCount > 0) {
      return res.status(400).json({
        message: `Cannot delete category "${category.name}" because it contains ${assetCount} active asset(s). Please reassign or delete the assets first, or deactivate the category instead.`,
      });
    }

    await GalleryCategory.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete category', error: error.message });
  }
};

module.exports = {
  getGalleryAssets,
  getGalleryCategories,
  getGalleryAssetById,
  recordAssetUsage,
  uploadGalleryAsset,
  updateGalleryAsset,
  toggleAssetStatus,
  deleteGalleryAsset,
  getGalleryStats,
  createCategory,
  updateCategory,
  deleteCategory,
};

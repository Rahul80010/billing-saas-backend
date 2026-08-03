const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const axios = require('axios');
const { 
  uploadBufferToStorage, 
  deleteImageFromStorage, 
  generateUuidFilename, 
  getTenantKeyPath 
} = require('../services/storageService');

const { fetchImageBufferFromAnyUrl } = require('./uploadController');

/**
 * Helper to download external Image URL and convert to Mohuri Cloud WebP URL
 */
const processExternalImageUrl = async (userId, imageUrl, folder = 'products') => {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) return imageUrl;
  
  const publicCdn = process.env.R2_PUBLIC_DOMAIN || '';
  if (publicCdn && imageUrl.startsWith(publicCdn)) return imageUrl;

  try {
    const { buffer, mimeType } = await fetchImageBufferFromAnyUrl(imageUrl);

    const uuidFile = generateUuidFilename('webp');
    const origKey = getTenantKeyPath(userId, folder, uuidFile, false);
    const thumbKey = getTenantKeyPath(userId, folder, uuidFile, true);

    const [url, thumbnail] = await Promise.all([
      uploadBufferToStorage(buffer, origKey, mimeType),
      uploadBufferToStorage(buffer, thumbKey, mimeType)
    ]);

    return {
      url,
      thumbnail,
      fileName: uuidFile,
      size: buffer.length,
      mimeType,
      width: 800,
      height: 800
    };
  } catch (err) {
    console.error('Failed to download external image URL:', err.message);
    return imageUrl;
  }
};

// @desc    Get all products (with populated variants & live recalculated stats)
// @route   GET /api/products
// @access  Private
const getProducts = async (req, res) => {
  try {
    const products = await Product.find({ userId: req.user._id }).sort({ createdAt: -1 }).lean();
    const productIds = products.map(p => p._id);
    const allVariants = await ProductVariant.find({ productId: { $in: productIds } }).lean();

    const variantsGrouped = {};
    allVariants.forEach(v => {
      const pid = v.productId.toString();
      if (!variantsGrouped[pid]) variantsGrouped[pid] = [];
      variantsGrouped[pid].push(v);
    });

    const populatedProducts = products.map(p => {
      const pVariants = variantsGrouped[p._id.toString()] || [];
      if (pVariants.length > 0) {
        const minPrice = Math.min(...pVariants.map(v => v.price));
        const minBuyingCost = Math.min(...pVariants.map(v => v.buyingCost || 0));
        const totalStock = pVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
        return {
          ...p,
          price: minPrice,
          buyingCost: minBuyingCost,
          stock: totalStock,
          variants: pVariants
        };
      }
      return {
        ...p,
        variants: []
      };
    });

    res.json(populatedProducts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a product (with embedded variants & image processing support)
// @route   POST /api/products
// @access  Private
const createProduct = async (req, res) => {
  try {
    let { name, price, gst, stock, unit, buyingCost, barcode, sku, hsnCode, category, lowStockAlert, lowStockAlertEnabled, description, image, images, variants } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Product name is required' });
    }

    // Check duplicate Product Name
    const existingName = await Product.findOne({
      userId: req.user._id,
      name: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    if (existingName) {
      return res.status(400).json({ message: `Product "${name.trim()}" is already added! (Yeh product pehle se added hai)` });
    }

    // Check duplicate Barcode if provided
    if (barcode && barcode.trim()) {
      const existingBarcode = await Product.findOne({
        userId: req.user._id,
        barcode: barcode.trim()
      });
      if (existingBarcode) {
        return res.status(400).json({ message: `Product with barcode "${barcode.trim()}" is already added!` });
      }
    }

    // Check duplicate SKU if provided
    if (sku && sku.trim()) {
      const existingSku = await Product.findOne({
        userId: req.user._id,
        sku: sku.trim()
      });
      if (existingSku) {
        return res.status(400).json({ message: `Product with SKU "${sku.trim()}" is already added!` });
      }
    }

    // Download external image URL if CSV imported
    if (typeof image === 'string' && image.startsWith('http')) {
      image = await processExternalImageUrl(req.user._id, image, 'products');
    }

    const product = new Product({
      userId: req.user._id,
      name: name.trim(),
      price: (price === undefined || price === null || price === '') ? 0 : Number(price),
      gst: (gst === undefined || gst === null || gst === '') ? 0 : Number(gst),
      stock: (stock === undefined || stock === null || stock === '') ? 0 : Number(stock),
      unit: unit || 'pcs',
      buyingCost: (buyingCost === undefined || buyingCost === null || buyingCost === '') ? 0 : Number(buyingCost),
      barcode: barcode !== undefined ? barcode.trim() : '',
      sku: sku !== undefined ? sku.trim() : '',
      hsnCode: hsnCode !== undefined ? hsnCode.trim() : '',
      category: category !== undefined ? category.trim() : '',
      lowStockAlert: (lowStockAlert === undefined || lowStockAlert === null || lowStockAlert === '') ? 5 : Number(lowStockAlert),
      lowStockAlertEnabled: lowStockAlertEnabled !== undefined ? Boolean(lowStockAlertEnabled) : true,
      description: description !== undefined ? description.trim() : '',
      image: image !== undefined ? image : '',
      images: Array.isArray(images) ? images : [],
    });

    const createdProduct = await product.save();

    // If embedded variants array passed
    let createdVariants = [];
    if (Array.isArray(variants) && variants.length > 0) {
      for (const v of variants) {
        if (v.variantName && v.price !== undefined) {
          let varImg = v.image;
          if (typeof varImg === 'string' && varImg.startsWith('http')) {
            varImg = await processExternalImageUrl(req.user._id, varImg, 'variants');
          }
          const newVar = new ProductVariant({
            productId: createdProduct._id,
            userId: req.user._id,
            variantName: String(v.variantName).trim(),
            barcode: v.barcode ? String(v.barcode).trim() : '',
            sku: v.sku ? String(v.sku).trim() : '',
            price: Number(v.price),
            buyingCost: v.buyingCost !== undefined && v.buyingCost !== '' ? Number(v.buyingCost) : 0,
            stock: v.stock !== undefined && v.stock !== '' ? Number(v.stock) : 0,
            lowStockAlert: v.lowStockAlert !== undefined && v.lowStockAlert !== '' ? Number(v.lowStockAlert) : 5,
            image: varImg || '',
            status: v.status || 'active',
            hsnCode: v.hsnCode ? String(v.hsnCode).trim() : (createdProduct.hsnCode || '')
          });
          const savedVar = await newVar.save();
          createdVariants.push(savedVar);
        }
      }

      if (createdVariants.length > 0) {
        const minPrice = Math.min(...createdVariants.map(v => v.price));
        const minBuyingCost = Math.min(...createdVariants.map(v => v.buyingCost || 0));
        const totalStock = createdVariants.reduce((sum, v) => sum + (v.stock || 0), 0);

        createdProduct.price = minPrice;
        createdProduct.buyingCost = minBuyingCost;
        createdProduct.stock = totalStock;
        await createdProduct.save();
      }
    }

    const responseObj = createdProduct.toObject();
    responseObj.variants = createdVariants;
    res.status(201).json(responseObj);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a product (with embedded variants & cloud image cleanup)
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  try {
    let { name, price, gst, stock, unit, buyingCost, barcode, sku, hsnCode, category, lowStockAlert, lowStockAlertEnabled, description, image, images, variants } = req.body;
    const product = await Product.findOne({ _id: req.params.id, userId: req.user._id });

    if (product) {
      if (name !== undefined && name.trim().toLowerCase() !== product.name.toLowerCase()) {
        const existingName = await Product.findOne({
          userId: req.user._id,
          name: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          _id: { $ne: product._id }
        });
        if (existingName) {
          return res.status(400).json({ message: `Product "${name.trim()}" is already added!` });
        }
      }

      if (barcode !== undefined && barcode.trim() && barcode.trim() !== product.barcode) {
        const existingBarcode = await Product.findOne({
          userId: req.user._id,
          barcode: barcode.trim(),
          _id: { $ne: product._id }
        });
        if (existingBarcode) {
          return res.status(400).json({ message: `Product with barcode "${barcode.trim()}" is already added!` });
        }
      }

      if (sku !== undefined && sku.trim() && sku.trim() !== product.sku) {
        const existingSku = await Product.findOne({
          userId: req.user._id,
          sku: sku.trim(),
          _id: { $ne: product._id }
        });
        if (existingSku) {
          return res.status(400).json({ message: `Product with SKU "${sku.trim()}" is already added!` });
        }
      }

      // If image is being replaced, purge old image from cloud
      if (image !== undefined && image !== product.image && product.image) {
        await deleteImageFromStorage(product.image);
      }

      if (typeof image === 'string' && image.startsWith('http')) {
        image = await processExternalImageUrl(req.user._id, image, 'products');
      }

      product.name = name !== undefined ? name.trim() : product.name;
      product.price = price !== undefined ? Number(price) : product.price;
      product.gst = (gst === undefined || gst === null || gst === '') ? 0 : Number(gst);
      product.stock = (stock !== undefined && stock !== null && stock !== '') ? Number(stock) : product.stock;
      product.unit = unit !== undefined ? unit : product.unit;
      product.buyingCost = (buyingCost !== undefined && buyingCost !== null && buyingCost !== '') ? Number(buyingCost) : product.buyingCost;
      product.barcode = barcode !== undefined ? barcode.trim() : product.barcode;
      product.sku = sku !== undefined ? sku.trim() : product.sku;
      if (hsnCode !== undefined) product.hsnCode = hsnCode.trim();
      if (category !== undefined) product.category = category.trim();
      if (lowStockAlert !== undefined && lowStockAlert !== null && lowStockAlert !== '') product.lowStockAlert = Number(lowStockAlert);
      if (lowStockAlertEnabled !== undefined) product.lowStockAlertEnabled = Boolean(lowStockAlertEnabled);
      if (description !== undefined) product.description = description.trim();
      if (image !== undefined) product.image = image;
      if (images !== undefined && Array.isArray(images)) product.images = images;

      // If variants array passed
      if (Array.isArray(variants)) {
        for (const v of variants) {
          if (v._id) {
            await ProductVariant.updateOne(
              { _id: v._id, userId: req.user._id },
              { $set: v }
            );
          } else if (v.variantName && v.price !== undefined) {
            const newVar = new ProductVariant({
              productId: product._id,
              userId: req.user._id,
              variantName: String(v.variantName).trim(),
              barcode: v.barcode ? String(v.barcode).trim() : '',
              sku: v.sku ? String(v.sku).trim() : '',
              price: Number(v.price),
              buyingCost: v.buyingCost !== undefined && v.buyingCost !== '' ? Number(v.buyingCost) : 0,
              stock: v.stock !== undefined && v.stock !== '' ? Number(v.stock) : 0,
              lowStockAlert: v.lowStockAlert !== undefined && v.lowStockAlert !== '' ? Number(v.lowStockAlert) : 5,
              status: v.status || 'active',
              hsnCode: v.hsnCode ? String(v.hsnCode).trim() : (product.hsnCode || '')
            });
            await newVar.save();
          }
        }
      }

      // Recalculate stats from variants
      const existingVariants = await ProductVariant.find({ productId: product._id });
      if (existingVariants.length > 0) {
        product.price = Math.min(...existingVariants.map(v => v.price));
        product.buyingCost = Math.min(...existingVariants.map(v => v.buyingCost || 0));
        product.stock = existingVariants.reduce((sum, v) => sum + (v.stock || 0), 0);
      }

      const updatedProduct = await product.save();
      const responseObj = updatedProduct.toObject();
      responseObj.variants = existingVariants;
      res.json(responseObj);
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a product and purge all associated cloud storage images
// @route   DELETE /api/products/:id
// @access  Private
const deleteProduct = async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const product = await Product.findOne({ _id: req.params.id, userId: req.user._id });

    if (product) {
      // Delete cloud storage files for variants & main product
      const variants = await ProductVariant.find({ productId: product._id });
      for (const v of variants) {
        if (v.image) {
          await deleteImageFromStorage(v.image);
        }
      }
      if (product.image) {
        await deleteImageFromStorage(product.image);
      }
      if (Array.isArray(product.images)) {
        await deleteImageFromStorage(product.images);
      }

      // Delete database records
      await ProductVariant.deleteMany({ productId: product._id });
      await product.deleteOne();
      res.json({ message: 'Product and associated cloud images removed' });
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Bulk Delete products and purge all cloud storage images
// @route   POST /api/products/bulk-delete
// @access  Private
const bulkDeleteProducts = async (req, res) => {
  try {
    const { productIds } = req.body;
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: 'No product IDs provided for deletion.' });
    }

    const products = await Product.find({ _id: { $in: productIds }, userId: req.user._id });

    for (const p of products) {
      const variants = await ProductVariant.find({ productId: p._id });
      for (const v of variants) {
        if (v.image) {
          await deleteImageFromStorage(v.image);
        }
      }
      if (p.image) {
        await deleteImageFromStorage(p.image);
      }
      if (Array.isArray(p.images)) {
        await deleteImageFromStorage(p.images);
      }
      await ProductVariant.deleteMany({ productId: p._id });
      await p.deleteOne();
    }

    res.json({ message: `Successfully deleted ${products.length} products and purged cloud images.` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
};

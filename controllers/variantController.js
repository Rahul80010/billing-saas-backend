const ProductVariant = require('../models/ProductVariant');
const Product = require('../models/Product');
const { deleteImageFromStorage } = require('../services/storageService');

// @desc    Get variants (for a product or all user variants)
// @route   GET /api/variants
// @access  Private
const getVariants = async (req, res) => {
  try {
    const { productId } = req.query;
    let query = { userId: req.user._id };
    if (productId) {
      const product = await Product.findOne({ _id: productId, userId: req.user._id });
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      query.productId = productId;
    }
    const variants = await ProductVariant.find(query).sort({ createdAt: 1 });
    res.json(variants);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get variants for multiple products at once (for product list page)
// @route   GET /api/variants/bulk?productIds=id1,id2,...
// @access  Private
const getBulkVariants = async (req, res) => {
  try {
    const { productIds } = req.query;
    if (!productIds) return res.json({});

    const ids = productIds.split(',').filter(Boolean);
    const variants = await ProductVariant.find({
      userId: req.user._id,
      productId: { $in: ids },
    });

    // Group by productId
    const grouped = {};
    variants.forEach(v => {
      const pid = v.productId.toString();
      if (!grouped[pid]) grouped[pid] = [];
      grouped[pid].push(v);
    });
    res.json(grouped);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Find variant by barcode (for billing scanner)
// @route   GET /api/variants/barcode/:code
// @access  Private
const getVariantByBarcode = async (req, res) => {
  try {
    const { code } = req.params;
    if (!code || !code.trim()) {
      return res.status(400).json({ message: 'Barcode is required' });
    }
    const variant = await ProductVariant.findOne({
      userId: req.user._id,
      barcode: code.trim(),
      status: 'active',
    }).populate('productId', 'name gst unit buyingCost');

    if (!variant) {
      return res.status(404).json({ message: 'No variant found for this barcode' });
    }
    res.json(variant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a variant
// @route   POST /api/variants
// @access  Private
const createVariant = async (req, res) => {
  try {
    const { productId, variantName, barcode, sku, price, buyingCost, stock, lowStockAlert, image, status, hsnCode } = req.body;

    if (!productId || !variantName || price === undefined || price === null || price === '') {
      return res.status(400).json({ message: 'productId, variantName and price are required' });
    }

    // Ensure product belongs to user
    const product = await Product.findOne({ _id: productId, userId: req.user._id });
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check duplicate variant name within product (case-insensitive)
    const existing = await ProductVariant.findOne({
      productId,
      userId: req.user._id,
      variantName: { $regex: new RegExp(`^${variantName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    if (existing) {
      return res.status(400).json({ message: `Variant "${variantName.trim()}" is already added for this product!` });
    }

    // Check duplicate barcode globally (within user)
    if (barcode && barcode.trim()) {
      const barcodeExists = await ProductVariant.findOne({ userId: req.user._id, barcode: barcode.trim() });
      if (barcodeExists) {
        return res.status(400).json({ message: `Barcode "${barcode.trim()}" is already used by another variant!` });
      }
    }

    // Check duplicate SKU globally (within user)
    if (sku && sku.trim()) {
      const skuExists = await ProductVariant.findOne({ userId: req.user._id, sku: sku.trim() });
      if (skuExists) {
        return res.status(400).json({ message: `SKU "${sku.trim()}" is already used by another variant!` });
      }
    }

    const variant = new ProductVariant({
      productId,
      userId: req.user._id,
      variantName: variantName.trim(),
      barcode: barcode ? barcode.trim() : '',
      sku: sku ? sku.trim() : '',
      price: Number(price),
      buyingCost: buyingCost !== undefined && buyingCost !== '' ? Number(buyingCost) : 0,
      stock: stock !== undefined && stock !== '' ? Number(stock) : 0,
      lowStockAlert: lowStockAlert !== undefined && lowStockAlert !== '' ? Number(lowStockAlert) : 5,
      image: image || '',
      status: status || 'active',
      hsnCode: hsnCode ? hsnCode.trim() : (product.hsnCode || ''),
    });

    const created = await variant.save();
    await updateParentProductStats(productId);
    res.status(201).json(created);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Variant name already exists for this product' });
    }
    res.status(400).json({ message: error.message });
  }
};

// Helper: recalculate and update parent product price, buyingCost, stock
const updateParentProductStats = async (productId) => {
  try {
    const variants = await ProductVariant.find({ productId });
    const product = await Product.findById(productId);
    if (!product) return;

    if (variants.length > 0) {
      const minPrice = Math.min(...variants.map(v => v.price));
      const minBuyingCost = Math.min(...variants.map(v => v.buyingCost || 0));
      const totalStock = variants.reduce((sum, v) => sum + (v.stock || 0), 0);

      product.price = minPrice;
      product.buyingCost = minBuyingCost;
      product.stock = totalStock;
    }
    await product.save();
  } catch (err) {
    console.error('Error updating parent product stats:', err);
  }
};

// @desc    Update a variant
// @route   PUT /api/variants/:id
// @access  Private
const updateVariant = async (req, res) => {
  try {
    const { variantName, barcode, sku, price, buyingCost, stock, lowStockAlert, image, status, hsnCode } = req.body;

    const variant = await ProductVariant.findOne({ _id: req.params.id, userId: req.user._id });
    if (!variant) {
      return res.status(404).json({ message: 'Variant not found' });
    }

    // Check duplicate variant name within product (exclude self)
    if (variantName && variantName.trim().toLowerCase() !== variant.variantName.toLowerCase()) {
      const nameExists = await ProductVariant.findOne({
        productId: variant.productId,
        userId: req.user._id,
        variantName: { $regex: new RegExp(`^${variantName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        _id: { $ne: variant._id },
      });
      if (nameExists) {
        return res.status(400).json({ message: `Variant "${variantName.trim()}" is already added for this product!` });
      }
    }

    // Check duplicate barcode (exclude self)
    if (barcode && barcode.trim() && barcode.trim() !== variant.barcode) {
      const barcodeExists = await ProductVariant.findOne({
        userId: req.user._id,
        barcode: barcode.trim(),
        _id: { $ne: variant._id },
      });
      if (barcodeExists) {
        return res.status(400).json({ message: `Barcode "${barcode.trim()}" is already used by another variant!` });
      }
    }

    // Check duplicate SKU (exclude self)
    if (sku && sku.trim() && sku.trim() !== variant.sku) {
      const skuExists = await ProductVariant.findOne({
        userId: req.user._id,
        sku: sku.trim(),
        _id: { $ne: variant._id },
      });
      if (skuExists) {
        return res.status(400).json({ message: `SKU "${sku.trim()}" is already used by another variant!` });
      }
    }

    if (variantName !== undefined) variant.variantName = variantName.trim();
    if (barcode !== undefined) variant.barcode = barcode.trim();
    if (sku !== undefined) variant.sku = sku.trim();
    if (price !== undefined && price !== '') variant.price = Number(price);
    if (buyingCost !== undefined && buyingCost !== '') variant.buyingCost = Number(buyingCost);
    if (stock !== undefined && stock !== '') variant.stock = Number(stock);
    if (lowStockAlert !== undefined && lowStockAlert !== '') variant.lowStockAlert = Number(lowStockAlert);
    if (image !== undefined) variant.image = image;
    if (status !== undefined) variant.status = status;
    if (hsnCode !== undefined) variant.hsnCode = hsnCode.trim();

    const updated = await variant.save();
    await updateParentProductStats(variant.productId);
    res.json(updated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Variant name already exists for this product' });
    }
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a variant
// @route   DELETE /api/variants/:id
// @access  Private
const deleteVariant = async (req, res) => {
  try {
    const variant = await ProductVariant.findOne({ _id: req.params.id, userId: req.user._id });
    if (variant) {
      if (variant.image) {
        await deleteImageFromStorage(variant.image);
      }
      const pid = variant.productId;
      await variant.deleteOne();
      await updateParentProductStats(pid);
      res.json({ message: 'Variant deleted' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getVariants,
  getBulkVariants,
  getVariantByBarcode,
  createVariant,
  updateVariant,
  deleteVariant,
};

const Product = require('../models/Product');

// @desc    Get all products
// @route   GET /api/products
// @access  Private
const getProducts = async (req, res) => {
  try {
    const products = await Product.find({ userId: req.user._id });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Create a product
// @route   POST /api/products
// @access  Private
const createProduct = async (req, res) => {
  const { name, price, gst, stock, unit, buyingCost, barcode, sku, hsnCode, category, lowStockAlert, lowStockAlertEnabled } = req.body;

  try {
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Product name is required' });
    }

    // Check duplicate product name (case-insensitive) for this user
    const existingName = await Product.findOne({
      userId: req.user._id,
      name: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });

    if (existingName) {
      return res.status(400).json({ message: `Product "${name.trim()}" is already added! (Yeh product pehle se added hai)` });
    }

    // Check duplicate barcode if provided
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

    const product = new Product({
      userId: req.user._id,
      name: name.trim(),
      price,
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
    });

    const createdProduct = await product.save();
    res.status(201).json(createdProduct);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private
const updateProduct = async (req, res) => {
  const { name, price, gst, stock, unit, buyingCost, barcode, sku, hsnCode, category, lowStockAlert, lowStockAlertEnabled } = req.body;

  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const product = await Product.findOne({ _id: req.params.id, userId: req.user._id });

    if (product) {
      if (name !== undefined && name.trim().toLowerCase() !== product.name.toLowerCase()) {
        const existingName = await Product.findOne({
          userId: req.user._id,
          name: { $regex: new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          _id: { $ne: product._id }
        });
        if (existingName) {
          return res.status(400).json({ message: `Product "${name.trim()}" is already added! (Yeh product pehle se added hai)` });
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

      product.name = name !== undefined ? name.trim() : product.name;
      product.price = price !== undefined ? price : product.price;
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

      const updatedProduct = await product.save();
      res.json(updatedProduct);
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private
const deleteProduct = async (req, res) => {
  try {
    if (!req.params.id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(404).json({ message: 'Product not found' });
    }
    const product = await Product.findOne({ _id: req.params.id, userId: req.user._id });

    if (product) {
      await product.deleteOne();
      res.json({ message: 'Product removed' });
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};

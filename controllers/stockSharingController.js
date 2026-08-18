const crypto = require('crypto');
const User = require('../models/User');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const StockOrder = require('../models/StockOrder');
const Bill = require('../models/Bill');
const Customer = require('../models/Customer');
const Notification = require('../models/Notification');
const { getIO } = require('../services/socketService');

/**
 * Generate unique store token
 */
const generateUniqueStoreToken = async () => {
  let token = '';
  let exists = true;
  while (exists) {
    token = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 characters, e.g., 'A8F931C2'
    const found = await User.findOne({ storeToken: token });
    if (!found) exists = false;
  }
  return token;
};

// ==========================================
// PUBLIC CUSTOMER STORE CONTROLLER
// ==========================================

/**
 * @desc    Get public shop stock & details by storeToken
 * @route   GET /api/public/store/:storeToken
 * @access  Public
 */
exports.getPublicStore = async (req, res) => {
  try {
    const { storeToken } = req.params;
    const user = await User.findOne({ storeToken: storeToken.toUpperCase() }).lean();

    if (!user || !user.enableCustomerStockSharing) {
      return res.status(404).json({ message: 'Online ordering is currently unavailable.' });
    }

    // Fetch all products for tenant
    const products = await Product.find({ userId: user._id }).sort({ createdAt: -1 }).lean();
    const productIds = products.map(p => p._id);
    const variants = await ProductVariant.find({ productId: { $in: productIds } }).lean();

    const variantsMap = {};
    variants.forEach(v => {
      const pid = v.productId.toString();
      if (!variantsMap[pid]) variantsMap[pid] = [];
      variantsMap[pid].push({
        _id: v._id,
        variantName: v.variantName,
        price: v.price,
        buyingCost: v.buyingCost || 0,
        stock: v.stock || 0,
        image: v.image || '',
        status: v.status || 'active',
      });
    });

    // Extract categories
    const categoriesSet = new Set();
    products.forEach(p => {
      if (p.category && p.category.trim()) categoriesSet.add(p.category.trim());
    });

    // Format products list
    const formattedProducts = products.map(p => {
      const pVars = (variantsMap[p._id.toString()] || []).filter(v => v.status === 'active');
      const hasVars = pVars.length > 0;
      
      // Calculate display selling price and stock
      let displayPrice = p.price;
      let displayStock = p.stock || 0;

      if (hasVars) {
        displayPrice = Math.min(...pVars.map(v => v.price));
        displayStock = pVars.reduce((sum, v) => sum + (v.stock || 0), 0);
      }

      return {
        _id: p._id,
        name: p.name,
        description: p.description || '',
        price: displayPrice,
        stock: displayStock,
        unit: p.unit || 'pcs',
        category: p.category || '',
        foodType: p.foodType || 'Veg',
        image: p.image || '',
        imageUrl: typeof p.image === 'object' ? p.image?.url : p.image,
        gst: p.gst || 0,
        variants: pVars,
        hasVariants: hasVars,
      };
    });

    res.json({
      storeToken: user.storeToken,
      storeName: user.storeName || user.businessName || user.name || 'Mohuri Store',
      storeDescription: user.storeDescription || '',
      storeContactPhone: user.storeContactPhone || user.businessPhone || '',
      storeAddress: user.storeAddress || user.businessAddress || '',
      storeOpeningHours: user.storeOpeningHours || '',
      logo: user.logo || '',
      enableRestaurantMode: !!user.enableRestaurantMode,
      showStockQuantity: user.showStockQuantity !== false,
      showOutOfStockProducts: user.showOutOfStockProducts !== false,
      allowOnlineOrdering: user.allowOnlineOrdering !== false,
      minOrderAmount: user.minOrderAmount || 0,
      orderInstructions: user.orderInstructions || '',
      categories: Array.from(categoriesSet),
      products: formattedProducts,
    });
  } catch (error) {
    console.error('getPublicStore error:', error);
    res.status(500).json({ message: 'Failed to load store data.' });
  }
};

/**
 * @desc    Place customer online stock order
 * @route   POST /api/public/store/:storeToken/order
 * @access  Public
 */
exports.placePublicOrder = async (req, res) => {
  try {
    const { storeToken } = req.params;
    const { customerName, customerPhone, deliveryAddress, notes, items, idempotencyKey } = req.body;

    const user = await User.findOne({ storeToken: storeToken.toUpperCase() });
    if (!user || !user.enableCustomerStockSharing) {
      return res.status(403).json({ message: 'Online ordering is currently disabled for this store.' });
    }

    if (user.allowOnlineOrdering === false) {
      return res.status(403).json({ message: 'Store is currently accepting product browsing only. Online ordering is paused.' });
    }

    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ message: 'Customer Name is required.' });
    }

    if (!customerPhone || !customerPhone.trim() || customerPhone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({ message: 'Valid 10-digit Mobile Number is required.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least 1 product.' });
    }

    // Idempotency check: prevent duplicate order within 30 seconds
    if (idempotencyKey) {
      const existingOrder = await StockOrder.findOne({
        storeToken: user.storeToken,
        orderToken: idempotencyKey,
      });
      if (existingOrder) {
        return res.json(existingOrder);
      }
    }

    // Backend Re-validation of Prices, Taxes, and Stock
    const processedItems = [];
    let subtotal = 0;
    let taxTotal = 0;

    for (const item of items) {
      const { productId, variantId, quantity } = item;
      const qty = Math.max(1, Number(quantity) || 1);

      const product = await Product.findOne({ _id: productId, userId: user._id });
      if (!product) {
        return res.status(400).json({ message: 'One or more products are no longer available.' });
      }

      let variant = null;
      let unitPrice = product.price;
      let unitBuyingCost = product.buyingCost || 0;
      let availableStock = product.stock || 0;
      let variantName = '';

      if (variantId) {
        variant = await ProductVariant.findOne({ _id: variantId, productId: product._id, userId: user._id });
        if (!variant || variant.status === 'inactive') {
          return res.status(400).json({ message: `Selected variant for "${product.name}" is unavailable.` });
        }
        unitPrice = variant.price;
        unitBuyingCost = variant.buyingCost || 0;
        availableStock = variant.stock || 0;
        variantName = variant.variantName;
      }

      // Stock Safety Check
      if (availableStock < qty) {
        return res.status(400).json({
          message: availableStock > 0
            ? `Only ${availableStock} units of "${product.name}${variantName ? ` (${variantName})` : ''}" available.`
            : `"${product.name}${variantName ? ` (${variantName})` : ''}" is currently Out of Stock.`
        });
      }

      const itemTotal = unitPrice * qty;
      const gstRate = product.gst || 0;
      const itemTax = (itemTotal * gstRate) / 100;

      subtotal += itemTotal;
      taxTotal += itemTax;

      processedItems.push({
        product: product._id,
        variant: variant ? variant._id : null,
        productName: product.name,
        variantName: variantName,
        quantity: qty,
        price: unitPrice,
        buyingCost: unitBuyingCost,
        gst: gstRate,
        unit: product.unit || 'pcs',
        total: itemTotal,
      });
    }

    const grandTotal = Math.round(subtotal + taxTotal);

    if (user.minOrderAmount > 0 && grandTotal < user.minOrderAmount) {
      return res.status(400).json({
        message: `Minimum order amount for this store is ₹${user.minOrderAmount}. Current total: ₹${grandTotal}`
      });
    }

    // Generate Order Number STO-YYYY-XXXXXX
    const count = await StockOrder.countDocuments({ tenantId: user._id });
    const year = new Date().getFullYear();
    const orderNumber = `STO-${year}-${(count + 1).toString().padStart(6, '0')}`;
    const orderToken = idempotencyKey || crypto.randomBytes(12).toString('hex');

    const stockOrder = new StockOrder({
      tenantId: user._id,
      storeToken: user.storeToken,
      orderNumber,
      orderToken,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      deliveryAddress: (deliveryAddress || '').trim(),
      notes: (notes || '').trim(),
      items: processedItems,
      subtotal,
      taxTotal,
      totalAmount: grandTotal,
      status: 'Pending',
      orderSource: 'Customer Stock Link',
      paymentMethod: 'Pay at Store / COD',
      reservedUntil: new Date(Date.now() + 60 * 60 * 1000), // 1 Hour reservation
      statusHistory: [{ status: 'Pending', note: 'Order placed via Customer Online Stock Link' }],
    });

    await stockOrder.save();

    // Auto save/update customer in tenant database
    try {
      const cleanPhone = customerPhone.trim();
      let cust = await Customer.findOne({ userId: user._id, phone: cleanPhone });
      if (!cust) {
        cust = new Customer({
          userId: user._id,
          name: customerName.trim(),
          phone: cleanPhone,
          address: (deliveryAddress || '').trim(),
        });
        await cust.save();
      }
    } catch (cErr) {
      console.warn('Customer auto-save error:', cErr.message);
    }

    // Create Notification entry
    try {
      await Notification.create({
        userId: user._id,
        title: `📦 New Online Stock Order #${orderNumber}`,
        message: `${customerName.trim()} placed an online order of ₹${grandTotal} (${processedItems.length} items).`,
        type: 'Online Stock Order',
        data: { stockOrderId: stockOrder._id, orderNumber }
      });
    } catch (nErr) {
      console.warn('Notification create error:', nErr.message);
    }

    // Emit Socket.IO event to Tenant room
    try {
      const io = getIO();
      io.to(`tenant_${user._id}`).emit('new_stock_order', {
        stockOrder,
        message: `New Online Stock Order #${orderNumber} from ${customerName.trim()}`,
      });
    } catch (sErr) {
      console.warn('Socket emit error:', sErr.message);
    }

    res.status(201).json({
      success: true,
      message: 'Order received successfully!',
      orderNumber: stockOrder.orderNumber,
      orderToken: stockOrder.orderToken,
      storeToken: stockOrder.storeToken,
      customerName: stockOrder.customerName,
      totalAmount: stockOrder.totalAmount,
      items: stockOrder.items,
      createdAt: stockOrder.createdAt,
    });
  } catch (error) {
    console.error('placePublicOrder error:', error);
    res.status(500).json({ message: error.message || 'Failed to place order.' });
  }
};

/**
 * @desc    Track public customer stock order by orderToken
 * @route   GET /api/public/store/:storeToken/track/:orderToken
 * @access  Public
 */
exports.trackPublicOrder = async (req, res) => {
  try {
    const { storeToken, orderToken } = req.params;
    const order = await StockOrder.findOne({
      storeToken: storeToken.toUpperCase(),
      orderToken: orderToken,
    }).lean();

    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const user = await User.findOne({ _id: order.tenantId }).lean();

    res.json({
      orderNumber: order.orderNumber,
      orderToken: order.orderToken,
      status: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      deliveryAddress: order.deliveryAddress,
      items: order.items,
      subtotal: order.subtotal,
      taxTotal: order.taxTotal,
      totalAmount: order.totalAmount,
      createdAt: order.createdAt,
      statusHistory: order.statusHistory || [],
      storeName: user?.storeName || user?.businessName || 'Mohuri Store',
      storePhone: user?.storeContactPhone || user?.businessPhone || '',
    });
  } catch (error) {
    console.error('trackPublicOrder error:', error);
    res.status(500).json({ message: 'Failed to fetch order tracking info.' });
  }
};

// ==========================================
// TENANT PROTECTED CONTROLLER
// ==========================================

/**
 * @desc    Get Tenant Store Sharing Settings
 * @route   GET /api/stock-sharing/settings
 * @access  Private
 */
exports.getStoreSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.storeToken) {
      user.storeToken = await generateUniqueStoreToken();
      await user.save();
    }

    res.json({
      enableCustomerStockSharing: Boolean(user.enableCustomerStockSharing),
      storeToken: user.storeToken,
      storeName: user.storeName || user.businessName || '',
      storeDescription: user.storeDescription || '',
      storeContactPhone: user.storeContactPhone || user.businessPhone || '',
      storeAddress: user.storeAddress || user.businessAddress || '',
      storeOpeningHours: user.storeOpeningHours || '',
      showStockQuantity: user.showStockQuantity !== false,
      showOutOfStockProducts: user.showOutOfStockProducts !== false,
      allowOnlineOrdering: user.allowOnlineOrdering !== false,
      minOrderAmount: user.minOrderAmount || 0,
      orderInstructions: user.orderInstructions || '',
    });
  } catch (error) {
    console.error('getStoreSettings error:', error);
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
};

/**
 * @desc    Update Tenant Store Sharing Settings
 * @route   PUT /api/stock-sharing/settings
 * @access  Private
 */
exports.updateStoreSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.storeToken) {
      user.storeToken = await generateUniqueStoreToken();
    }

    const {
      enableCustomerStockSharing,
      storeName,
      storeDescription,
      storeContactPhone,
      storeAddress,
      storeOpeningHours,
      showStockQuantity,
      showOutOfStockProducts,
      allowOnlineOrdering,
      minOrderAmount,
      orderInstructions,
    } = req.body;

    if (enableCustomerStockSharing !== undefined) user.enableCustomerStockSharing = Boolean(enableCustomerStockSharing);
    if (storeName !== undefined) user.storeName = storeName.trim();
    if (storeDescription !== undefined) user.storeDescription = storeDescription.trim();
    if (storeContactPhone !== undefined) user.storeContactPhone = storeContactPhone.trim();
    if (storeAddress !== undefined) user.storeAddress = storeAddress.trim();
    if (storeOpeningHours !== undefined) user.storeOpeningHours = storeOpeningHours.trim();
    if (showStockQuantity !== undefined) user.showStockQuantity = Boolean(showStockQuantity);
    if (showOutOfStockProducts !== undefined) user.showOutOfStockProducts = Boolean(showOutOfStockProducts);
    if (allowOnlineOrdering !== undefined) user.allowOnlineOrdering = Boolean(allowOnlineOrdering);
    if (minOrderAmount !== undefined) user.minOrderAmount = Math.max(0, Number(minOrderAmount) || 0);
    if (orderInstructions !== undefined) user.orderInstructions = orderInstructions.trim();

    await user.save();

    res.json({
      message: 'Store sharing settings updated successfully',
      enableCustomerStockSharing: user.enableCustomerStockSharing,
      storeToken: user.storeToken,
      storeName: user.storeName,
      storeDescription: user.storeDescription,
      storeContactPhone: user.storeContactPhone,
      storeAddress: user.storeAddress,
      storeOpeningHours: user.storeOpeningHours,
      showStockQuantity: user.showStockQuantity,
      showOutOfStockProducts: user.showOutOfStockProducts,
      allowOnlineOrdering: user.allowOnlineOrdering,
      minOrderAmount: user.minOrderAmount,
      orderInstructions: user.orderInstructions,
    });
  } catch (error) {
    console.error('updateStoreSettings error:', error);
    res.status(500).json({ message: 'Failed to update store settings' });
  }
};

/**
 * @desc    Regenerate Store Link Token
 * @route   POST /api/stock-sharing/regenerate-token
 * @access  Private
 */
exports.regenerateStoreToken = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.storeToken = await generateUniqueStoreToken();
    await user.save();

    res.json({
      message: 'Store link regenerated successfully. Previous link is now invalid.',
      storeToken: user.storeToken,
    });
  } catch (error) {
    console.error('regenerateStoreToken error:', error);
    res.status(500).json({ message: 'Failed to regenerate store token' });
  }
};

/**
 * @desc    Get Tenant Online Stock Orders Dashboard
 * @route   GET /api/stock-sharing/orders
 * @access  Private
 */
exports.getStockOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const query = { tenantId: req.user._id };

    if (status && status !== 'All') {
      query.status = status;
    }

    if (search && search.trim()) {
      const q = search.trim();
      query.$or = [
        { orderNumber: { $regex: q, $options: 'i' } },
        { customerName: { $regex: q, $options: 'i' } },
        { customerPhone: { $regex: q, $options: 'i' } },
      ];
    }

    const orders = await StockOrder.find(query).sort({ createdAt: -1 }).lean();

    // Summary Analytics Calculation
    const allOrders = await StockOrder.find({ tenantId: req.user._id }).lean();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let todayOrdersCount = 0;
    let monthlySalesTotal = 0;
    let pendingCount = 0;
    let completedCount = 0;
    const productSalesMap = {};

    allOrders.forEach(o => {
      const oDate = new Date(o.createdAt);
      if (oDate >= todayStart) todayOrdersCount += 1;
      if (oDate >= monthStart && o.status === 'Completed') monthlySalesTotal += (o.totalAmount || 0);

      if (o.status === 'Pending') pendingCount += 1;
      if (o.status === 'Completed') completedCount += 1;

      if (o.status === 'Completed' && Array.isArray(o.items)) {
        o.items.forEach(i => {
          const name = i.productName + (i.variantName ? ` (${i.variantName})` : '');
          productSalesMap[name] = (productSalesMap[name] || 0) + i.quantity;
        });
      }
    });

    const topProducts = Object.entries(productSalesMap)
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    res.json({
      orders,
      stats: {
        todayOrdersCount,
        monthlySalesTotal,
        pendingCount,
        completedCount,
        totalOrdersCount: allOrders.length,
        topProducts,
      }
    });
  } catch (error) {
    console.error('getStockOrders error:', error);
    res.status(500).json({ message: 'Failed to fetch online stock orders' });
  }
};

/**
 * @desc    Update Stock Order Status
 * @route   PUT /api/stock-sharing/orders/:id/status
 * @access  Private
 */
exports.updateStockOrderStatus = async (req, res) => {
  try {
    const { status, note } = req.body;
    const validStatuses = ['Pending', 'Confirmed', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid order status' });
    }

    const order = await StockOrder.findOne({ _id: req.params.id, tenantId: req.user._id });
    if (!order) return res.status(404).json({ message: 'Stock order not found' });

    const prevStatus = order.status;
    order.status = status;
    order.statusHistory.push({
      status,
      updatedAt: new Date(),
      note: note || `Status updated from ${prevStatus} to ${status}`,
    });

    // If marked Completed, deduct stock from inventory if not already deducted
    if (status === 'Completed' && prevStatus !== 'Completed') {
      order.isPaid = true;
      for (const item of order.items) {
        if (item.variant) {
          await ProductVariant.updateOne(
            { _id: item.variant, userId: req.user._id },
            { $inc: { stock: -item.quantity } }
          );
        } else if (item.product) {
          await Product.updateOne(
            { _id: item.product, userId: req.user._id },
            { $inc: { stock: -item.quantity } }
          );
        }
      }
    }

    await order.save();

    // Socket notification
    try {
      const io = getIO();
      io.to(`tenant_${req.user._id}`).emit('stock_order_status_updated', order);
    } catch (sErr) {
      console.warn('Socket emit error:', sErr.message);
    }

    res.json(order);
  } catch (error) {
    console.error('updateStockOrderStatus error:', error);
    res.status(500).json({ message: 'Failed to update order status' });
  }
};

/**
 * @desc    1-Click Create Bill from Online Stock Order
 * @route   POST /api/stock-sharing/orders/:id/create-bill
 * @access  Private
 */
exports.createBillFromStockOrder = async (req, res) => {
  try {
    const { paymentMethod = 'Cash' } = req.body;
    const stockOrder = await StockOrder.findOne({ _id: req.params.id, tenantId: req.user._id });

    if (!stockOrder) return res.status(404).json({ message: 'Stock order not found' });
    if (stockOrder.billId) return res.status(400).json({ message: 'Bill has already been created for this order.' });

    // Map items to Bill items format
    const billItems = stockOrder.items.map(i => ({
      productName: i.productName,
      price: i.price,
      quantity: i.quantity,
      gst: i.gst || 0,
      unit: i.unit || 'pcs',
      buyingCost: i.buyingCost || 0,
      variantId: i.variant || null,
      variantName: i.variantName || '',
    }));

    const bill = new Bill({
      userId: req.user._id,
      customerName: stockOrder.customerName,
      customerPhone: stockOrder.customerPhone,
      customerAddress: stockOrder.deliveryAddress || '',
      items: billItems,
      total: stockOrder.totalAmount,
      paymentType: 'Paid',
      paymentMethod: paymentMethod || 'Cash',
      paidAmount: stockOrder.totalAmount,
      remainingAmount: 0,
      status: 'paid',
      payments: [{
        amount: stockOrder.totalAmount,
        note: `Paid via Online Stock Order #${stockOrder.orderNumber}`,
        date: new Date(),
      }],
    });

    const createdBill = await bill.save();

    // Update product & variant stock according to standard Mohuri inventory rules
    for (const item of stockOrder.items) {
      if (item.variant) {
        await ProductVariant.updateOne(
          { _id: item.variant, userId: req.user._id },
          { $inc: { stock: -item.quantity } }
        );
      } else if (item.product) {
        await Product.updateOne(
          { _id: item.product, userId: req.user._id },
          { $inc: { stock: -item.quantity } }
        );
      }
    }

    // Link Bill ID to Stock Order & update status to Completed
    stockOrder.billId = createdBill._id;
    stockOrder.status = 'Completed';
    stockOrder.isPaid = true;
    stockOrder.statusHistory.push({
      status: 'Completed',
      note: `Bill created #${createdBill._id} & marked Completed`,
    });
    await stockOrder.save();

    res.status(201).json({
      message: 'Bill created successfully from Online Stock Order!',
      bill: createdBill,
      stockOrder,
    });
  } catch (error) {
    console.error('createBillFromStockOrder error:', error);
    res.status(500).json({ message: error.message || 'Failed to create bill' });
  }
};

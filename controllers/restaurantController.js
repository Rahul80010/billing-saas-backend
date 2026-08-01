const RestaurantTable = require('../models/RestaurantTable');
const RestaurantOrder = require('../models/RestaurantOrder');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const User = require('../models/User');
const { getIO } = require('../services/socketService');

// ==========================================
// ADMIN/MANAGER ENDPOINTS
// ==========================================

exports.createTable = async (req, res) => {
  try {
    const { tableName, tableNumber } = req.body;
    
    // Check if tableNumber already exists for this tenant
    const existing = await RestaurantTable.findOne({ tenantId: req.user.id, tableNumber });
    if (existing) {
      return res.status(400).json({ message: 'Table number already exists' });
    }

    const table = new RestaurantTable({
      tenantId: req.user.id,
      tableName,
      tableNumber,
    });
    
    // Generate QR Data link
    // E.g., https://mohuri.com/menu/[tenantId]/[tableId]
    table.qrCodeData = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/menu/${req.user.id}/${table._id}`;
    
    await table.save();
    res.status(201).json(table);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.getTables = async (req, res) => {
  try {
    const tables = await RestaurantTable.find({ tenantId: req.user.id }).sort({ tableNumber: 1 });
    res.json(tables);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.updateTable = async (req, res) => {
  try {
    const { tableName, tableNumber, status } = req.body;
    const table = await RestaurantTable.findOne({ _id: req.params.id, tenantId: req.user.id });
    
    if (!table) return res.status(404).json({ message: 'Table not found' });
    
    if (tableName) table.tableName = tableName;
    if (tableNumber) table.tableNumber = tableNumber;
    if (status) table.status = status;
    
    await table.save();
    
    // Emit event if status changes
    const io = getIO();
    io.to(`tenant_${req.user.id}`).emit('table_updated', table);
    
    res.json(table);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.deleteTable = async (req, res) => {
  try {
    const table = await RestaurantTable.findOneAndDelete({ _id: req.params.id, tenantId: req.user.id });
    if (!table) return res.status(404).json({ message: 'Table not found' });
    res.json({ message: 'Table removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// ==========================================
// PUBLIC CUSTOMER ENDPOINTS
// ==========================================

exports.getPublicMenu = async (req, res) => {
  try {
    const { tenantId, tableId } = req.params;
    
    const tenant = await User.findById(tenantId).select('name businessName logo enableRestaurantMode');
    if (!tenant || !tenant.enableRestaurantMode) {
      return res.status(404).json({ message: 'Restaurant not found or mode disabled' });
    }
    
    const table = await RestaurantTable.findOne({ _id: tableId, tenantId });
    if (!table) {
      return res.status(404).json({ message: 'Table not found' });
    }

    const products = await Product.find({ userId: tenantId }).lean();
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
        return {
          ...p,
          sellingPrice: minPrice, // Maps to sellingPrice expected by frontend
          imageUrl: p.image || (p.images && p.images[0]) || null,
          variants: pVariants
        };
      }
      return {
        ...p,
        sellingPrice: p.price,
        imageUrl: p.image || (p.images && p.images[0]) || null,
        variants: []
      };
    });
    
    res.json({
      restaurant: {
        name: tenant.businessName || tenant.name,
        logo: tenant.logo
      },
      table: {
        id: table._id,
        name: table.tableName,
        number: table.tableNumber
      },
      menu: populatedProducts
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.placeOrder = async (req, res) => {
  try {
    const { tenantId, tableId, items, totalAmount } = req.body;

    const table = await RestaurantTable.findOne({ _id: tableId, tenantId });
    if (!table) return res.status(404).json({ message: 'Table not found' });

    // Generate Order Number
    const count = await RestaurantOrder.countDocuments({ tenantId });
    const orderNumber = `ORD-${Date.now().toString().slice(-4)}-${count + 1}`;

    const order = new RestaurantOrder({
      tenantId,
      tableId,
      orderNumber,
      items,
      totalAmount,
      status: 'Received'
    });

    await order.save();
    
    // Update table status
    table.status = 'Occupied';
    await table.save();

    // Populate items for frontend
    await order.populate('items.product items.variant tableId');

    // Emit via WebSocket to Kitchen
    const io = getIO();
    io.to(`kitchen_${tenantId}`).emit('new_order', order);
    io.to(`tenant_${tenantId}`).emit('table_updated', table);

    res.status(201).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.getOrderStatus = async (req, res) => {
  try {
    const order = await RestaurantOrder.findById(req.params.orderId).populate('items.product items.variant tableId');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// ==========================================
// KITCHEN & BILLING ENDPOINTS
// ==========================================

exports.getActiveOrders = async (req, res) => {
  try {
    const orders = await RestaurantOrder.find({ 
      tenantId: req.user.id, 
      status: { $in: ['Received', 'Preparing', 'Ready', 'Served'] }
    }).populate('items.product items.variant tableId').sort({ createdAt: 1 });
    
    res.json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const order = await RestaurantOrder.findOne({ _id: req.params.id, tenantId: req.user.id }).populate('items.product items.variant tableId');
    
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    order.status = status;
    await order.save();
    
    const io = getIO();
    
    // Notify customer
    io.to(`table_${order.tableId._id}`).emit('order_status_updated', order);
    
    // If Ready, notify Billing
    if (status === 'Ready' || status === 'Served') {
      io.to(`billing_${req.user.id}`).emit('order_ready', order);
    }
    
    // Notify Kitchen
    io.to(`kitchen_${req.user.id}`).emit('order_status_updated', order);

    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const RestaurantTable = require('../models/RestaurantTable');
const RestaurantOrder = require('../models/RestaurantOrder');
const Product = require('../models/Product');
const ProductVariant = require('../models/ProductVariant');
const User = require('../models/User');
const Customer = require('../models/Customer');
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
    
    // Fetch latest active order for this table if any (unpaid and not completed/cancelled)
    const activeOrder = await RestaurantOrder.findOne({
      tenantId,
      tableId,
      status: { $in: ['Received', 'Preparing', 'Ready', 'Served'] },
      isPaid: false
    }).sort({ createdAt: -1 }).populate('items.product items.variant tableId').lean();

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
      menu: populatedProducts,
      activeOrder: activeOrder || null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.placeOrder = async (req, res) => {
  try {
    const tenantId = req.user ? req.user.id : req.body.tenantId;
    const { tableId, items, customerName, customerPhone, notes, orderType } = req.body;

    if (!tenantId) {
      return res.status(400).json({ message: 'Tenant ID is required' });
    }

    const table = await RestaurantTable.findOne({ _id: tableId, tenantId });
    if (!table) return res.status(404).json({ message: 'Table not found' });

    // Format items to match Mongoose orderItemSchema
    const formattedItems = (items || []).map(i => ({
      product: i.product || i.productId,
      variant: i.variant || i.variantId || undefined,
      quantity: Number(i.quantity) || 1,
      price: Number(i.price) || 0,
      specialInstructions: i.specialInstructions || i.notes || '',
    }));

    if (formattedItems.length === 0) {
      return res.status(400).json({ message: 'Order must contain at least 1 item' });
    }

    // Calculate total if not provided
    const totalAmount = req.body.totalAmount !== undefined 
      ? Number(req.body.totalAmount) 
      : formattedItems.reduce((acc, item) => acc + (item.price * item.quantity), 0);

    // Generate Order Number
    const count = await RestaurantOrder.countDocuments({ tenantId });
    const orderNumber = `ORD-${Date.now().toString().slice(-4)}-${count + 1}`;

    const order = new RestaurantOrder({
      tenantId,
      tableId,
      orderNumber,
      items: formattedItems,
      orderType: orderType || 'Dine-in',
      customerName: customerName || '',
      customerPhone: customerPhone || '',
      notes: notes || '',
      totalAmount,
      status: 'Received'
    });

    await order.save();

    // Auto Save / Create Customer in DB for this Tenant
    if (customerPhone && customerPhone.trim()) {
      const cleanPhone = customerPhone.trim();
      const cleanName = (customerName && customerName.trim()) ? customerName.trim() : 'Guest';
      try {
        let existingCust = await Customer.findOne({ userId: tenantId, phone: cleanPhone });
        if (!existingCust) {
          existingCust = new Customer({
            userId: tenantId,
            name: cleanName,
            phone: cleanPhone
          });
          await existingCust.save();
        } else if (cleanName && cleanName !== 'Guest' && existingCust.name !== cleanName) {
          existingCust.name = cleanName;
          await existingCust.save();
        }
      } catch (custErr) {
        console.error('Auto save customer error:', custErr);
      }
    }
    
    // Update table status to Ordering
    table.status = 'Ordering';
    await table.save();

    // Populate items for frontend
    await order.populate('items.product items.variant tableId');

    // Emit via WebSocket to Kitchen & Tenant (Waiter)
    const io = getIO();
    io.to(`kitchen_${tenantId}`).emit('new_order', order);
    io.to(`tenant_${tenantId}`).emit('new_order', order);
    io.to(`tenant_${tenantId}`).emit('table_updated', table);

    res.status(201).json(order);
  } catch (error) {
    console.error('placeOrder error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

exports.lookupCustomerByPhone = async (req, res) => {
  try {
    const { tenantId, phone } = req.params;
    if (!tenantId || !phone) {
      return res.status(400).json({ message: 'tenantId and phone are required' });
    }
    const cleanPhone = phone.trim();
    const customer = await Customer.findOne({ userId: tenantId, phone: cleanPhone });
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json({ name: customer.name, phone: customer.phone, _id: customer._id });
  } catch (error) {
    console.error('lookupCustomerByPhone error:', error);
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
    if (status === 'Preparing') order.kitchenAcceptedAt = new Date();
    if (status === 'Ready') order.readyAt = new Date();
    if (status === 'Completed') order.completedAt = new Date();
    
    await order.save();
    
    const io = getIO();
    
    // Notify customer
    io.to(`table_${order.tableId._id}`).emit('order_status_updated', order);
    
    // If Ready, notify Billing & Tenant (Waiter)
    if (status === 'Ready' || status === 'Served') {
      io.to(`billing_${req.user.id}`).emit('order_ready', order);
      io.to(`tenant_${req.user.id}`).emit('order_ready', order);
    }
    
    // Notify Kitchen & Tenant (Waiter)
    io.to(`kitchen_${req.user.id}`).emit('order_status_updated', order);
    io.to(`tenant_${req.user.id}`).emit('order_status_updated', order);

    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// ==========================================
// WAITER CALL & REQUEST ENDPOINTS
// ==========================================

const WaiterRequest = require('../models/WaiterRequest');

exports.createWaiterRequest = async (req, res) => {
  try {
    const { tenantId, tableId, requestType } = req.body;
    const table = await RestaurantTable.findOne({ _id: tableId, tenantId });
    if (!table) return res.status(404).json({ message: 'Table not found' });

    const request = new WaiterRequest({
      tenantId,
      tableId,
      requestType,
      status: 'Pending',
    });

    await request.save();
    await request.populate('tableId');

    const io = getIO();
    const strTenant = tenantId.toString();
    io.to(`tenant_${strTenant}`).emit('waiter_request_alert', request);
    io.emit('waiter_request_alert', request);

    res.status(201).json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.getPendingWaiterRequests = async (req, res) => {
  try {
    const requests = await WaiterRequest.find({ tenantId: req.user.id, status: 'Pending' })
      .populate('tableId')
      .sort({ createdAt: -1 });
    res.json(requests);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.resolveWaiterRequest = async (req, res) => {
  try {
    const request = await WaiterRequest.findOneAndUpdate(
      { _id: req.params.id, tenantId: req.user.id },
      { status: 'Attended' },
      { new: true }
    );
    if (!request) return res.status(404).json({ message: 'Request not found' });

    const io = getIO();
    const strUser = req.user.id.toString();
    io.to(`tenant_${strUser}`).emit('waiter_request_resolved', request);
    io.emit('waiter_request_resolved', request);

    res.json(request);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.resolveAllWaiterRequests = async (req, res) => {
  try {
    await WaiterRequest.updateMany(
      { tenantId: req.user.id, status: 'Pending' },
      { status: 'Attended' }
    );

    const io = getIO();
    const strUser = req.user.id.toString();
    io.to(`tenant_${strUser}`).emit('waiter_requests_cleared_all');
    io.emit('waiter_requests_cleared_all');

    res.json({ message: 'All waiter requests marked as attended' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};



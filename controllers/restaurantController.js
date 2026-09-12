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
    const { tableName, tableNumber, capacity, section, isRoom, roomType, floor, currentGuestName, currentGuestPhone } = req.body;
    
    // Check if tableNumber already exists for this tenant
    const existing = await RestaurantTable.findOne({ tenantId: req.user.id, tableNumber });
    if (existing) {
      return res.status(400).json({ message: isRoom ? 'Room number already exists' : 'Table number already exists' });
    }

    const table = new RestaurantTable({
      tenantId: req.user.id,
      tableName: tableName || (isRoom ? `Room ${tableNumber}` : `Table ${tableNumber}`),
      tableNumber,
      capacity: Number(capacity) || (isRoom ? 2 : 4),
      section: section || floor || (isRoom ? '1st Floor' : 'Ground Floor'),
      isRoom: !!isRoom,
      roomType: roomType || 'Standard',
      floor: floor || section || '1st Floor',
      currentGuestName: currentGuestName || '',
      currentGuestPhone: currentGuestPhone || '',
    });
    
    // Generate QR Data link
    table.qrCodeData = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/menu/${req.user.id}/${table._id}`;
    
    await table.save();
    res.status(201).json(table);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.bulkCreateRooms = async (req, res) => {
  try {
    const { startNumber, endNumber, floor, roomType, prefix } = req.body;
    const start = parseInt(startNumber);
    const end = parseInt(endNumber);
    const roomPrefix = (prefix || 'Room').trim();
    const roomFloor = (floor || '1st Floor').trim();
    const type = (roomType || 'Standard').trim();

    if (isNaN(start) || isNaN(end) || start > end) {
      return res.status(400).json({ message: 'Invalid start or end room number' });
    }

    if (end - start > 100) {
      return res.status(400).json({ message: 'Cannot create more than 100 rooms in one batch' });
    }

    const createdRooms = [];
    for (let num = start; num <= end; num++) {
      const existing = await RestaurantTable.findOne({ tenantId: req.user.id, tableNumber: num });
      if (!existing) {
        const room = new RestaurantTable({
          tenantId: req.user.id,
          tableName: `${roomPrefix} ${num}`,
          tableNumber: num,
          isRoom: true,
          roomType: type,
          floor: roomFloor,
          section: roomFloor,
          capacity: 2,
        });
        room.qrCodeData = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/menu/${req.user.id}/${room._id}`;
        await room.save();
        createdRooms.push(room);
      }
    }

    res.status(201).json({ message: `Successfully created ${createdRooms.length} room(s)`, rooms: createdRooms });
  } catch (error) {
    console.error('bulkCreateRooms error:', error);
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
    const { tableName, tableNumber, status, capacity, section, isRoom, roomType, floor, currentGuestName, currentGuestPhone } = req.body;
    const table = await RestaurantTable.findOne({ _id: req.params.id, tenantId: req.user.id });
    
    if (!table) return res.status(404).json({ message: 'Record not found' });
    
    if (tableName !== undefined) table.tableName = tableName;
    if (tableNumber !== undefined) table.tableNumber = tableNumber;
    if (status !== undefined) table.status = status;
    if (capacity !== undefined) table.capacity = Number(capacity);
    if (section !== undefined) table.section = section;
    if (isRoom !== undefined) table.isRoom = !!isRoom;
    if (roomType !== undefined) table.roomType = roomType;
    if (floor !== undefined) table.floor = floor;
    if (currentGuestName !== undefined) table.currentGuestName = currentGuestName;
    if (currentGuestPhone !== undefined) table.currentGuestPhone = currentGuestPhone;
    
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
    if (!table) return res.status(404).json({ message: 'Record not found' });
    res.json({ message: table.isRoom ? 'Room removed' : 'Table removed' });
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
    
    const tenant = await User.findById(tenantId).select(
      'name businessName logo enableRestaurantMode enableHotelMode hotelAllowRoomCharge hotelServiceCharge hotelWifiName hotelWifiPassword hotelReceptionPhone'
    );
    if (!tenant || (!tenant.enableRestaurantMode && !tenant.enableHotelMode)) {
      return res.status(404).json({ message: 'Store not found or dining/room service mode disabled' });
    }
    
    const table = await RestaurantTable.findOne({ _id: tableId, tenantId });
    if (!table) {
      return res.status(404).json({ message: 'Table or Room not found' });
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
    
    // Fetch ALL active unpaid orders for this table (sub-orders placed across rounds)
    const activeOrders = await RestaurantOrder.find({
      tenantId,
      tableId,
      status: { $in: ['Received', 'Preparing', 'Ready', 'Served'] },
      isPaid: false
    }).sort({ createdAt: 1 }).populate('items.product items.variant tableId').lean();

    let combinedActiveOrder = null;

    if (activeOrders && activeOrders.length > 0) {
      if (activeOrders.length === 1) {
        combinedActiveOrder = activeOrders[0];
      } else {
        // Merge all active sub-orders for this table into 1 combined active order
        const allItems = [];
        let grandTotal = 0;
        const orderNums = [];
        let highestStatus = activeOrders[0].status;
        const statusPriority = { 'Served': 4, 'Ready': 3, 'Preparing': 2, 'Received': 1 };

        activeOrders.forEach(ord => {
          orderNums.push(ord.orderNumber);
          grandTotal += Number(ord.totalAmount || 0);

          if ((statusPriority[ord.status] || 0) > (statusPriority[highestStatus] || 0)) {
            highestStatus = ord.status;
          }

          (ord.items || []).forEach(item => {
            allItems.push({
              ...item,
              parentOrderNumber: ord.orderNumber
            });
          });
        });

        combinedActiveOrder = {
          _id: activeOrders[activeOrders.length - 1]._id,
          orderNumber: orderNums.join(', '),
          status: highestStatus,
          totalAmount: grandTotal,
          items: allItems,
          createdAt: activeOrders[0].createdAt,
          subOrdersCount: activeOrders.length,
          allOrders: activeOrders
        };
      }
    }

    res.json({
      restaurant: {
        name: tenant.businessName || tenant.name,
        logo: tenant.logo,
        enableRestaurantMode: !!tenant.enableRestaurantMode,
        enableHotelMode: !!tenant.enableHotelMode,
        hotelAllowRoomCharge: tenant.hotelAllowRoomCharge !== false,
        hotelServiceCharge: tenant.hotelServiceCharge || 0,
        hotelWifiName: tenant.hotelWifiName || '',
        hotelWifiPassword: tenant.hotelWifiPassword || '',
        hotelReceptionPhone: tenant.hotelReceptionPhone || '',
      },
      table: {
        id: table._id,
        name: table.tableName,
        number: table.tableNumber,
        isRoom: !!table.isRoom,
        roomType: table.roomType || 'Standard',
        floor: table.floor || table.section || '1st Floor',
      },
      menu: populatedProducts,
      activeOrder: combinedActiveOrder
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error' });
  }
};

exports.placeOrder = async (req, res) => {
  try {
    const tenantId = req.user ? req.user.id : req.body.tenantId;
    const { tableId, items, customerName, customerPhone, notes, orderType, paymentOption } = req.body;

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

    const resolvedOrderType = orderType || (table.isRoom ? 'Room-Service' : 'Dine-in');
    const resolvedPaymentOption = paymentOption || 'Direct-Pay';
    const roomNumber = table.isRoom ? (table.tableName || `Room ${table.tableNumber}`) : '';

    const order = new RestaurantOrder({
      tenantId,
      tableId,
      orderNumber,
      items: formattedItems,
      orderType: resolvedOrderType,
      paymentOption: resolvedPaymentOption,
      roomNumber,
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

    // If it's a room and there is an active HotelBooking, attach food order to room folio
    if (table.isRoom) {
      try {
        const HotelBooking = require('../models/HotelBooking');
        const activeBooking = await HotelBooking.findOne({
          tenantId,
          roomId: table._id,
          status: 'Checked-In'
        });

        if (activeBooking) {
          const itemsSummary = (formattedItems || [])
            .map(item => `${item.quantity}x Item`)
            .join(', ');

          activeBooking.foodOrders.push({
            orderId: order._id,
            orderNumber: order.orderNumber,
            amount: totalAmount,
            date: new Date(),
            itemsSummary: itemsSummary
          });
          await activeBooking.save();

          const io = getIO();
          io.to(`tenant_${tenantId.toString()}`).emit('hotel_booking_updated', activeBooking);
        }
      } catch (hbErr) {
        console.warn('Could not attach order to active HotelBooking:', hbErr);
      }
    }

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



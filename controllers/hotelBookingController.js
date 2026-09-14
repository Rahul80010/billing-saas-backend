const HotelBooking = require('../models/HotelBooking');
const RestaurantTable = require('../models/RestaurantTable');
const RestaurantOrder = require('../models/RestaurantOrder');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { getIO } = require('../services/socketService');

const safeEmit = (channel, event, data) => {
  try {
    const io = getIO();
    if (io) io.to(channel).emit(event, data);
  } catch (err) {
    // Socket emit fallback
  }
};

// Check In Guest
exports.checkInGuest = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const {
      roomId,
      guestName,
      guestPhone,
      guestEmail,
      guestAddress,
      guestGender,
      guestAge,
      idProofType,
      idProofNumber,
      numberOfAdults,
      numberOfChildren,
      additionalGuests,
      checkInDate,
      expectedCheckOutDate,
      roomRatePerNight,
      advancePayment,
      advancePaymentMethod,
      specialRequests
    } = req.body;

    if (!roomId) {
      return res.status(400).json({ message: 'Room selection is required' });
    }
    if (!guestName || !guestName.trim()) {
      return res.status(400).json({ message: 'Guest name is required' });
    }
    if (!guestPhone || !guestPhone.trim()) {
      return res.status(400).json({ message: 'Guest phone number is required' });
    }

    const room = await RestaurantTable.findOne({ _id: roomId, tenantId });
    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.status === 'Occupied' || room.status === 'Eating' || room.status === 'Ordering') {
      return res.status(400).json({ message: `${room.tableName} is already occupied by ${room.currentGuestName || 'another guest'}` });
    }

    // Generate Booking Number: HTL-YYYYMMDD-XXXX
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const count = await HotelBooking.countDocuments({ tenantId });
    const bookingNumber = `HTL-${todayStr}-${(count + 1).toString().padStart(4, '0')}`;

    const checkIn = checkInDate ? new Date(checkInDate) : new Date();
    const rate = Number(roomRatePerNight) || 0;
    const advance = Number(advancePayment) || 0;

    // Filter and sanitize additional guests
    const cleanAdditionalGuests = Array.isArray(additionalGuests)
      ? additionalGuests
          .filter(g => g && g.name && g.name.trim())
          .map(g => ({
            name: g.name.trim(),
            phone: (g.phone || '').trim(),
            age: g.age ? Number(g.age) : null,
            gender: g.gender || '',
            relationship: (g.relationship || '').trim(),
            idProofType: g.idProofType || 'Aadhaar Card',
            idProofNumber: (g.idProofNumber || '').trim(),
          }))
      : [];

    const booking = new HotelBooking({
      tenantId,
      bookingNumber,
      roomId: room._id,
      roomNumber: room.tableNumber,
      roomName: room.tableName,
      roomType: room.roomType || 'Standard',
      floor: room.floor || room.section || '1st Floor',
      guestName: guestName.trim(),
      guestPhone: guestPhone.trim(),
      guestEmail: (guestEmail || '').trim(),
      guestAddress: (guestAddress || '').trim(),
      guestGender: guestGender || '',
      guestAge: guestAge ? Number(guestAge) : null,
      idProofType: idProofType || 'Aadhaar Card',
      idProofNumber: (idProofNumber || '').trim(),
      numberOfAdults: Number(numberOfAdults) || (1 + cleanAdditionalGuests.length),
      numberOfChildren: Number(numberOfChildren) || 0,
      additionalGuests: cleanAdditionalGuests,
      checkInDate: checkIn,
      expectedCheckOutDate: expectedCheckOutDate ? new Date(expectedCheckOutDate) : null,
      roomRatePerNight: rate,
      totalNights: 1,
      roomChargesTotal: rate,
      subTotal: rate,
      grandTotal: rate,
      advancePayment: advance,
      advancePaymentMethod: advancePaymentMethod || 'Cash',
      balanceDue: Math.max(0, rate - advance),
      paymentStatus: advance >= rate ? 'Paid' : (advance > 0 ? 'Partial' : 'Pending'),
      status: 'Checked-In',
      specialRequests: (specialRequests || '').trim(),
      checkedInBy: req.user.name || 'Front Desk',
      payments: advance > 0 ? [{
        amount: advance,
        paymentMethod: advancePaymentMethod || 'Cash',
        paidAt: new Date(),
        notes: 'Advance deposit during Check-In'
      }] : []
    });

    await booking.save();

    // Update Room table status
    room.status = 'Occupied';
    room.currentGuestName = guestName.trim();
    room.currentGuestPhone = guestPhone.trim();
    await room.save();

    // Auto-Save/Update Customer in CRM
    const cleanPhone = guestPhone.trim();
    const cleanName = guestName.trim();
    try {
      let cust = await Customer.findOne({ userId: tenantId, phone: cleanPhone });
      if (!cust) {
        cust = new Customer({
          userId: tenantId,
          name: cleanName,
          phone: cleanPhone,
          email: (guestEmail || '').trim(),
          address: (guestAddress || '').trim(),
        });
        await cust.save();
      } else {
        cust.name = cleanName;
        if (guestEmail) cust.email = guestEmail.trim();
        if (guestAddress) cust.address = guestAddress.trim();
        await cust.save();
      }
    } catch (cErr) {
      console.warn('Customer auto-save error:', cErr);
    }

    // Emit WebSocket update
    const strTenant = tenantId.toString();
    safeEmit(`tenant_${strTenant}`, 'table_updated', room);
    safeEmit(`tenant_${strTenant}`, 'hotel_booking_created', booking);

    res.status(201).json(booking);
  } catch (error) {
    console.error('checkInGuest error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// Helper to dynamically reconcile and sync all RestaurantOrder records for a room during booking period
const reconcileBookingFoodOrders = async (booking) => {
  try {
    const tenantId = booking.tenantId;
    const roomId = booking.roomId?._id || booking.roomId;
    if (!roomId) return;

    const query = {
      tenantId,
      tableId: roomId,
      createdAt: {
        $gte: new Date(booking.checkInDate),
        ...(booking.actualCheckOutDate ? { $lte: new Date(booking.actualCheckOutDate) } : {})
      },
      status: { $nin: ['Cancelled', 'Rejected'] }
    };

    const orders = await RestaurantOrder.find(query).populate('items.product');

    let modified = false;
    if (!Array.isArray(booking.foodOrders)) {
      booking.foodOrders = [];
      modified = true;
    }

    const existingOrderIds = new Set(
      booking.foodOrders.map(f => f.orderId ? f.orderId.toString() : (f._id ? f._id.toString() : ''))
    );

    for (const ord of orders) {
      if (!existingOrderIds.has(ord._id.toString())) {
        const itemsSummary = (ord.items || [])
          .map(item => `${item.quantity}x ${item.product?.name || 'Item'}`)
          .join(', ');

        booking.foodOrders.push({
          orderId: ord._id,
          orderNumber: ord.orderNumber,
          amount: ord.totalAmount,
          date: ord.createdAt,
          itemsSummary: itemsSummary || `${ord.items?.length || 1} items`
        });
        existingOrderIds.add(ord._id.toString());
        modified = true;
      }
    }

    if (modified) {
      await booking.save();
    }
  } catch (err) {
    console.warn('reconcileBookingFoodOrders warning:', err);
  }
};

// Get All Active In-House Bookings with live folio calculation
exports.getActiveBookings = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const bookings = await HotelBooking.find({ tenantId, status: 'Checked-In' })
      .populate('roomId')
      .sort({ checkInDate: -1 });

    // Reconcile and calculate live stay durations & live running balances
    const now = new Date();
    const liveBookings = await Promise.all(bookings.map(async b => {
      await reconcileBookingFoodOrders(b);
      const bObj = b.toObject();
      const checkIn = new Date(bObj.checkInDate);
      const diffMs = now.getTime() - checkIn.getTime();
      const rawNights = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const currentNights = Math.max(1, rawNights);

      const roomCharges = currentNights * bObj.roomRatePerNight;
      const foodTotal = (bObj.foodOrders || []).reduce((acc, f) => acc + (f.amount || 0), 0);
      const extraTotal = (bObj.extraServices || []).reduce((acc, s) => acc + (s.amount || 0), 0);
      const currentGrandTotal = roomCharges + foodTotal + extraTotal;
      const totalPaid = (bObj.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0) || bObj.advancePayment || 0;
      const liveBalance = Math.max(0, currentGrandTotal - totalPaid);

      return {
        ...bObj,
        currentNights,
        currentRoomCharges: roomCharges,
        currentFoodTotal: foodTotal,
        currentExtraTotal: extraTotal,
        currentGrandTotal,
        totalPaid,
        liveBalance
      };
    }));

    res.json(liveBookings);
  } catch (error) {
    console.error('getActiveBookings error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Get Single Booking Details with live calculations
exports.getBookingDetails = async (req, res) => {
  try {
    const booking = await HotelBooking.findOne({ _id: req.params.id, tenantId: req.user.id }).populate('roomId');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    await reconcileBookingFoodOrders(booking);

    const bObj = booking.toObject();
    const now = new Date();
    const checkIn = new Date(bObj.checkInDate);
    const diffMs = now.getTime() - checkIn.getTime();
    const rawNights = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const currentNights = Math.max(1, rawNights);

    const roomCharges = currentNights * bObj.roomRatePerNight;
    const foodTotal = (bObj.foodOrders || []).reduce((acc, f) => acc + (f.amount || 0), 0);
    const extraTotal = (bObj.extraServices || []).reduce((acc, s) => acc + (s.amount || 0), 0);
    const currentGrandTotal = roomCharges + foodTotal + extraTotal;
    const totalPaid = (bObj.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0) || bObj.advancePayment || 0;
    const liveBalance = Math.max(0, currentGrandTotal - totalPaid);

    res.json({
      ...bObj,
      currentNights,
      currentRoomCharges: roomCharges,
      currentFoodTotal: foodTotal,
      currentExtraTotal: extraTotal,
      currentGrandTotal,
      totalPaid,
      liveBalance
    });
  } catch (error) {
    console.error('getBookingDetails error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Add Extra Amenity / Service Charge to Folio
exports.addExtraCharge = async (req, res) => {
  try {
    const { serviceName, amount, notes } = req.body;
    if (!serviceName || !amount) {
      return res.status(400).json({ message: 'Service name and amount are required' });
    }

    const booking = await HotelBooking.findOne({ _id: req.params.id, tenantId: req.user.id });
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.status !== 'Checked-In') {
      return res.status(400).json({ message: 'Cannot add charges to a checked-out booking' });
    }

    booking.extraServices.push({
      serviceName: serviceName.trim(),
      amount: Number(amount),
      notes: (notes || '').trim(),
      date: new Date()
    });

    await booking.save();
    safeEmit(`tenant_${req.user.id}`, 'hotel_booking_updated', booking);

    res.json(booking);
  } catch (error) {
    console.error('addExtraCharge error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Record an Interim / Partial Payment during stay
exports.addPayment = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { amount, paymentMethod, notes } = req.body;
    const paymentAmt = Number(amount);

    if (!paymentAmt || paymentAmt <= 0) {
      return res.status(400).json({ message: 'A valid positive payment amount is required' });
    }

    const booking = await HotelBooking.findOne({ _id: req.params.id, tenantId }).populate('roomId');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    await reconcileBookingFoodOrders(booking);

    if (!Array.isArray(booking.payments)) {
      booking.payments = [];
    }

    booking.payments.push({
      amount: paymentAmt,
      paymentMethod: paymentMethod || 'Cash',
      paidAt: new Date(),
      notes: (notes || 'Interim Payment Received').trim()
    });

    // Recalculate totals
    const now = new Date();
    const checkIn = new Date(booking.checkInDate);
    const diffMs = now.getTime() - checkIn.getTime();
    const currentNights = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const roomCharges = currentNights * booking.roomRatePerNight;
    const foodTotal = (booking.foodOrders || []).reduce((acc, f) => acc + (f.amount || 0), 0);
    const extraTotal = (booking.extraServices || []).reduce((acc, s) => acc + (s.amount || 0), 0);
    const currentGrandTotal = roomCharges + foodTotal + extraTotal;
    const totalPaid = (booking.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0);

    booking.balanceDue = Math.max(0, currentGrandTotal - totalPaid);
    booking.paymentStatus = totalPaid >= currentGrandTotal ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Pending');

    await booking.save();
    safeEmit(`tenant_${tenantId.toString()}`, 'hotel_booking_updated', booking);

    res.json(booking);
  } catch (error) {
    console.error('addPayment error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// Remove Food Order from Folio
exports.deleteFoodOrder = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { id, orderId } = req.params;

    const booking = await HotelBooking.findOne({ _id: id, tenantId }).populate('roomId');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    booking.foodOrders = (booking.foodOrders || []).filter(
      f => f._id.toString() !== orderId && f.orderId?.toString() !== orderId
    );

    await booking.save();
    safeEmit(`tenant_${tenantId.toString()}`, 'hotel_booking_updated', booking);

    res.json(booking);
  } catch (error) {
    console.error('deleteFoodOrder error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// Check Out Guest & Settle Final Bill
exports.checkOutGuest = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const {
      totalNights,
      roomRatePerNight,
      discount,
      taxGstPercent,
      serviceCharges,
      settlementPaymentMethod,
      settlementAmount,
      postCheckOutRoomStatus,
      paymentNotes
    } = req.body;

    const booking = await HotelBooking.findOne({ _id: req.params.id, tenantId }).populate('roomId');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    if (booking.status !== 'Checked-In') {
      return res.status(400).json({ message: 'Guest is already checked out' });
    }

    await reconcileBookingFoodOrders(booking);

    const actualOut = new Date();
    const nights = Number(totalNights) || 1;
    const rate = Number(roomRatePerNight) !== undefined ? Number(roomRatePerNight) : booking.roomRatePerNight;
    const roomChargesTotal = nights * rate;

    const foodOrdersTotal = (booking.foodOrders || []).reduce((acc, f) => acc + (f.amount || 0), 0);
    const extraServicesTotal = (booking.extraServices || []).reduce((acc, s) => acc + (s.amount || 0), 0);

    const subTotal = roomChargesTotal + foodOrdersTotal + extraServicesTotal;
    const disc = Number(discount) || 0;
    const taxableAmount = Math.max(0, subTotal - disc);

    const gstPct = Number(taxGstPercent) || 0;
    const taxGst = Math.round((taxableAmount * gstPct) / 100);
    const sc = Number(serviceCharges) || 0;

    const grandTotal = taxableAmount + taxGst + sc;
    const previousPaid = (booking.payments || []).reduce((acc, p) => acc + (p.amount || 0), 0) || booking.advancePayment || 0;
    const finalBalanceDue = Math.max(0, grandTotal - previousPaid);

    const settledAmt = Number(settlementAmount) !== undefined ? Number(settlementAmount) : finalBalanceDue;
    const payMethod = settlementPaymentMethod || 'Cash';

    // Update Booking Record
    booking.actualCheckOutDate = actualOut;
    booking.totalNights = nights;
    booking.roomRatePerNight = rate;
    booking.roomChargesTotal = roomChargesTotal;
    booking.subTotal = subTotal;
    booking.discount = disc;
    booking.taxGstPercent = gstPct;
    booking.taxGst = taxGst;
    booking.serviceCharges = sc;
    booking.grandTotal = grandTotal;
    booking.settlementPaymentMethod = payMethod;
    booking.status = 'Checked-Out';
    booking.paymentStatus = (previousPaid + settledAmt >= grandTotal) ? 'Paid' : 'Partial';
    booking.balanceDue = Math.max(0, grandTotal - (previousPaid + settledAmt));
    booking.checkedOutBy = req.user.name || 'Front Desk';

    if (settledAmt > 0) {
      booking.payments.push({
        amount: settledAmt,
        paymentMethod: payMethod,
        paidAt: actualOut,
        notes: paymentNotes || 'Final Settlement at Check-Out'
      });
    }

    await booking.save();

    // Update Room table
    const room = await RestaurantTable.findOne({ _id: booking.roomId, tenantId });
    if (room) {
      // Default to Cleaning / Housekeeping so room can be cleaned, or Available if selected
      room.status = (postCheckOutRoomStatus === 'Available') ? 'Available' : 'Cleaning';
      room.currentGuestName = '';
      room.currentGuestPhone = '';
      await room.save();
    }

    // Complete all active room orders linked to this table
    await RestaurantOrder.updateMany(
      { tenantId, tableId: booking.roomId, status: { $in: ['Received', 'Preparing', 'Ready', 'Served'] } },
      { status: 'Completed', isPaid: true }
    );

    // Emit WebSocket updates
    const strTenant = tenantId.toString();
    if (room) {
      safeEmit(`tenant_${strTenant}`, 'table_updated', room);
    }
    safeEmit(`tenant_${strTenant}`, 'hotel_booking_checked_out', booking);

    res.json(booking);
  } catch (error) {
    console.error('checkOutGuest error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// Check-In / Check-Out History & Records
exports.getBookingHistory = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { search, status, startDate, endDate } = req.query;

    const filter = { tenantId };

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (startDate || endDate) {
      filter.checkInDate = {};
      if (startDate) filter.checkInDate.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.checkInDate.$lte = end;
      }
    }

    if (search && search.trim()) {
      const q = search.trim();
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { guestName: regex },
        { guestPhone: regex },
        { bookingNumber: regex },
        { roomName: regex },
        { idProofNumber: regex },
        { guestEmail: regex },
        { guestAddress: regex },
        { 'additionalGuests.name': regex },
        { 'additionalGuests.phone': regex },
        { 'additionalGuests.idProofNumber': regex }
      ];
    }

    const history = await HotelBooking.find(filter)
      .populate('roomId')
      .sort({ createdAt: -1 })
      .limit(200);

    res.json(history);
  } catch (error) {
    console.error('getBookingHistory error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Mark Room As Clean & Available (1-Click Housekeeping Complete)
exports.markRoomClean = async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await RestaurantTable.findOneAndUpdate(
      { _id: roomId, tenantId: req.user.id },
      { status: 'Available', currentGuestName: '', currentGuestPhone: '' },
      { new: true }
    );

    if (!room) return res.status(404).json({ message: 'Room not found' });

    const io = getIO();
    io.to(`tenant_${req.user.id}`).emit('table_updated', room);

    res.json(room);
  } catch (error) {
    console.error('markRoomClean error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// ==========================================
// HOTEL GUEST DIRECTORY & 360° ORDER HISTORY
// ==========================================

// Get all unique guests with aggregated statistics
exports.getHotelGuests = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { search, vipOnly } = req.query;

    const custQuery = { userId: tenantId };
    if (vipOnly === 'true') {
      custQuery.isVip = true;
    }

    if (search && search.trim()) {
      const q = search.trim();
      const regex = new RegExp(q, 'i');
      custQuery.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
        { idProofNumber: regex },
        { city: regex }
      ];
    }

    const customers = await Customer.find(custQuery).sort({ updatedAt: -1 });

    // Fetch all bookings for this tenant
    const allBookings = await HotelBooking.find({ tenantId }).sort({ checkInDate: -1 });
    // Fetch all restaurant orders for this tenant
    const allOrders = await RestaurantOrder.find({ tenantId });

    // Map customer stats
    const guestsList = customers.map(c => {
      const cPhone = (c.phone || '').trim();
      const guestBookings = allBookings.filter(b => (b.guestPhone || '').trim() === cPhone);
      const guestOrders = allOrders.filter(o => (o.customerPhone || '').trim() === cPhone);

      const totalStays = guestBookings.length;
      const totalStaySpent = guestBookings.reduce((sum, b) => sum + (b.grandTotal || b.subTotal || 0), 0);
      const totalFoodSpent = guestOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
      const totalLifetimeSpent = totalStaySpent + totalFoodSpent;

      const activeStay = guestBookings.find(b => b.status === 'Checked-In');
      const lastBooking = guestBookings[0];

      return {
        _id: c._id,
        name: c.name,
        phone: c.phone,
        email: c.email || '',
        address: c.address || '',
        city: c.city || '',
        idProofType: c.idProofType || 'Aadhaar Card',
        idProofNumber: c.idProofNumber || '',
        notes: c.notes || '',
        isVip: !!c.isVip,
        totalStays,
        totalFoodOrders: guestOrders.length,
        totalLifetimeSpent,
        currentInHouseRoom: activeStay ? (activeStay.roomName || `Room ${activeStay.roomNumber}`) : null,
        activeBookingId: activeStay ? activeStay._id : null,
        lastStayDate: lastBooking ? lastBooking.checkInDate : c.updatedAt,
        createdAt: c.createdAt
      };
    });

    res.json(guestsList);
  } catch (error) {
    console.error('getHotelGuests error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Get single guest 360° profile with full itemized orders & stay history
exports.getHotelGuestDetails = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { phoneOrId } = req.params;

    let customer = null;
    if (phoneOrId.match(/^[0-9a-fA-F]{24}$/)) {
      customer = await Customer.findOne({ _id: phoneOrId, userId: tenantId });
    }
    if (!customer) {
      customer = await Customer.findOne({ phone: phoneOrId.trim(), userId: tenantId });
    }

    const cleanPhone = customer ? customer.phone : phoneOrId.trim();

    // 1. Fetch all Bookings for this guest
    const bookings = await HotelBooking.find({
      tenantId,
      guestPhone: cleanPhone
    }).populate('roomId').sort({ checkInDate: -1 });

    // 2. Fetch all Food & In-Room Dining Orders with populated products and variants
    const foodOrders = await RestaurantOrder.find({
      tenantId,
      customerPhone: cleanPhone
    }).populate('items.product items.variant tableId').sort({ createdAt: -1 });

    const totalStays = bookings.length;
    const totalStaySpent = bookings.reduce((sum, b) => sum + (b.grandTotal || b.subTotal || 0), 0);
    const totalFoodSpent = foodOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalLifetimeSpent = totalStaySpent + totalFoodSpent;

    res.json({
      customer: customer || {
        name: bookings[0]?.guestName || foodOrders[0]?.customerName || 'Guest',
        phone: cleanPhone,
        idProofType: bookings[0]?.idProofType || 'Aadhaar Card',
        idProofNumber: bookings[0]?.idProofNumber || ''
      },
      bookings,
      foodOrders,
      summary: {
        totalStays,
        totalStaySpent,
        totalFoodOrders: foodOrders.length,
        totalFoodSpent,
        totalLifetimeSpent
      }
    });
  } catch (error) {
    console.error('getHotelGuestDetails error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Create New Hotel Guest
exports.createHotelGuest = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { name, phone, email, address, city, idProofType, idProofNumber, notes, isVip } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Guest name is required' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: 'Guest phone number is required' });
    }

    const cleanPhone = phone.trim();
    let customer = await Customer.findOne({ userId: tenantId, phone: cleanPhone });

    if (customer) {
      customer.name = name.trim();
      if (email) customer.email = email.trim();
      if (address) customer.address = address.trim();
      if (city) customer.city = city.trim();
      if (idProofType) customer.idProofType = idProofType;
      if (idProofNumber) customer.idProofNumber = idProofNumber.trim();
      if (notes !== undefined) customer.notes = notes.trim();
      if (isVip !== undefined) customer.isVip = !!isVip;
      await customer.save();
      return res.json(customer);
    }

    customer = new Customer({
      userId: tenantId,
      name: name.trim(),
      phone: cleanPhone,
      email: (email || '').trim(),
      address: (address || '').trim(),
      city: (city || '').trim(),
      idProofType: idProofType || 'Aadhaar Card',
      idProofNumber: (idProofNumber || '').trim(),
      notes: (notes || '').trim(),
      isVip: !!isVip
    });

    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    console.error('createHotelGuest error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// Update Existing Hotel Guest
exports.updateHotelGuest = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const { name, phone, email, address, city, idProofType, idProofNumber, notes, isVip } = req.body;

    const customer = await Customer.findOne({ _id: req.params.id, userId: tenantId });
    if (!customer) return res.status(404).json({ message: 'Customer not found' });

    if (name) customer.name = name.trim();
    if (phone) customer.phone = phone.trim();
    if (email !== undefined) customer.email = email.trim();
    if (address !== undefined) customer.address = address.trim();
    if (city !== undefined) customer.city = city.trim();
    if (idProofType) customer.idProofType = idProofType;
    if (idProofNumber !== undefined) customer.idProofNumber = idProofNumber.trim();
    if (notes !== undefined) customer.notes = notes.trim();
    if (isVip !== undefined) customer.isVip = !!isVip;

    await customer.save();
    res.json(customer);
  } catch (error) {
    console.error('updateHotelGuest error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

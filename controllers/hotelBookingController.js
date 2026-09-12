const HotelBooking = require('../models/HotelBooking');
const RestaurantTable = require('../models/RestaurantTable');
const RestaurantOrder = require('../models/RestaurantOrder');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { getIO } = require('../services/socketService');

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
      idProofType,
      idProofNumber,
      numberOfAdults,
      numberOfChildren,
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
      idProofType: idProofType || 'Aadhaar Card',
      idProofNumber: (idProofNumber || '').trim(),
      numberOfAdults: Number(numberOfAdults) || 1,
      numberOfChildren: Number(numberOfChildren) || 0,
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
    const io = getIO();
    const strTenant = tenantId.toString();
    io.to(`tenant_${strTenant}`).emit('table_updated', room);
    io.to(`tenant_${strTenant}`).emit('hotel_booking_created', booking);

    res.status(201).json(booking);
  } catch (error) {
    console.error('checkInGuest error:', error);
    res.status(500).json({ message: error.message || 'Server Error' });
  }
};

// Get All Active In-House Bookings with live folio calculation
exports.getActiveBookings = async (req, res) => {
  try {
    const tenantId = req.user.id;
    const bookings = await HotelBooking.find({ tenantId, status: 'Checked-In' })
      .populate('roomId')
      .sort({ checkInDate: -1 });

    // Calculate live stay durations & live running balances
    const now = new Date();
    const liveBookings = bookings.map(b => {
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
    });

    res.json(liveBookings);
  } catch (error) {
    console.error('getActiveBookings error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Get Single Booking Details
exports.getBookingDetails = async (req, res) => {
  try {
    const booking = await HotelBooking.findOne({ _id: req.params.id, tenantId: req.user.id }).populate('roomId');
    if (!booking) return res.status(404).json({ message: 'Booking not found' });
    res.json(booking);
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

    const io = getIO();
    io.to(`tenant_${req.user.id}`).emit('hotel_booking_updated', booking);

    res.json(booking);
  } catch (error) {
    console.error('addExtraCharge error:', error);
    res.status(500).json({ message: 'Server Error' });
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
    const io = getIO();
    const strTenant = tenantId.toString();
    if (room) {
      io.to(`tenant_${strTenant}`).emit('table_updated', room);
    }
    io.to(`tenant_${strTenant}`).emit('hotel_booking_checked_out', booking);

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
        { roomName: regex }
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

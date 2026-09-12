const mongoose = require('mongoose');

const hotelBookingSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  bookingNumber: {
    type: String,
    required: true,
    unique: true,
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RestaurantTable',
    required: true,
  },
  roomNumber: {
    type: Number,
    required: true,
  },
  roomName: {
    type: String,
    default: '',
  },
  roomType: {
    type: String,
    default: 'Standard',
  },
  floor: {
    type: String,
    default: '1st Floor',
  },
  // Guest Information
  guestName: {
    type: String,
    required: true,
    trim: true,
  },
  guestPhone: {
    type: String,
    required: true,
    trim: true,
  },
  guestEmail: {
    type: String,
    trim: true,
    default: '',
  },
  guestAddress: {
    type: String,
    trim: true,
    default: '',
  },
  idProofType: {
    type: String,
    enum: ['Aadhaar Card', 'Passport', 'Driving License', 'Voter ID', 'Govt ID', 'PAN Card', 'Other'],
    default: 'Aadhaar Card',
  },
  idProofNumber: {
    type: String,
    trim: true,
    default: '',
  },
  numberOfAdults: {
    type: Number,
    default: 1,
  },
  numberOfChildren: {
    type: Number,
    default: 0,
  },
  // Stay Dates & Rates
  checkInDate: {
    type: Date,
    default: Date.now,
  },
  expectedCheckOutDate: {
    type: Date,
  },
  actualCheckOutDate: {
    type: Date,
  },
  roomRatePerNight: {
    type: Number,
    required: true,
    default: 0,
  },
  totalNights: {
    type: Number,
    default: 1,
  },
  roomChargesTotal: {
    type: Number,
    default: 0,
  },
  // In-Room Dining Food Orders linked to room folio
  foodOrders: [
    {
      orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RestaurantOrder',
      },
      orderNumber: String,
      amount: Number,
      date: {
        type: Date,
        default: Date.now,
      },
      itemsSummary: String,
    }
  ],
  // Extra Amenities & Services (e.g. Laundry, Extra Bed, Minibar, Airport Cab)
  extraServices: [
    {
      serviceName: String,
      amount: Number,
      date: {
        type: Date,
        default: Date.now,
      },
      notes: String,
    }
  ],
  serviceCharges: {
    type: Number,
    default: 0,
  },
  taxGst: {
    type: Number,
    default: 0,
  },
  taxGstPercent: {
    type: Number,
    default: 0,
  },
  subTotal: {
    type: Number,
    default: 0,
  },
  discount: {
    type: Number,
    default: 0,
  },
  grandTotal: {
    type: Number,
    default: 0,
  },
  // Advance Deposit & Settlement Payments
  advancePayment: {
    type: Number,
    default: 0,
  },
  advancePaymentMethod: {
    type: String,
    enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'],
    default: 'Cash',
  },
  settlementPaymentMethod: {
    type: String,
    enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Split', 'Other'],
    default: 'Cash',
  },
  payments: [
    {
      amount: Number,
      paymentMethod: String,
      transactionId: String,
      paidAt: {
        type: Date,
        default: Date.now,
      },
      notes: String,
    }
  ],
  balanceDue: {
    type: Number,
    default: 0,
  },
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Partial', 'Paid', 'Refunded'],
    default: 'Pending',
  },
  status: {
    type: String,
    enum: ['Checked-In', 'Checked-Out', 'Cancelled', 'Reserved'],
    default: 'Checked-In',
  },
  specialRequests: {
    type: String,
    default: '',
  },
  checkedInBy: {
    type: String,
    default: '',
  },
  checkedOutBy: {
    type: String,
    default: '',
  },
}, { timestamps: true });

module.exports = mongoose.model('HotelBooking', hotelBookingSchema);

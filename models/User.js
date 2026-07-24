const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  otp: {
    type: String,
  },
  otpExpires: {
    type: Date,
  },
  resetPasswordOtp: {
    type: String,
  },
  resetPasswordOtpExpires: {
    type: Date,
  },
  businessName: {
    type: String,
    trim: true,
    default: '',
  },
  whatsappToken: {
    type: String,
    trim: true,
    default: '',
  },
  whatsappPhoneNumberId: {
    type: String,
    trim: true,
    default: '',
  },
  businessAddress: {
    type: String,
    trim: true,
    default: '',
  },
  businessPhone: {
    type: String,
    trim: true,
    default: '',
  },
  businessEmail: {
    type: String,
    trim: true,
    default: '',
  },
  gstin: {
    type: String,
    trim: true,
    default: '',
  },
  invoiceFooter: {
    type: String,
    trim: true,
    default: 'Thank you for your purchase! Please visit us again.',
  },
  logo: {
    type: String,
    default: '',
  },
  whatsappBillTemplate: {
    type: String,
    default: 'Hello {customerName}, here is your invoice from {businessName}.\nTotal: ₹{total}',
  },
  whatsappReminderTemplate: {
    type: String,
    default: 'Hello {customerName},\n\nThis is a friendly reminder from *{businessName}* that you have an outstanding balance of *₹{remainingAmount}* for Invoice #INV-{invoiceNo}.\n\n*Reminder Date:* {reminderDate}\n\nPlease settle it soon. Thank you! 🙏',
  },
  primaryColor: {
    type: String,
    default: '#093a84',
  },
  secondaryColor: {
    type: String,
    default: '#0066ff',
  },
  upiId: {
    type: String,
    trim: true,
    default: '',
  },
  upiName: {
    type: String,
    trim: true,
    default: '',
  },
  enableInvoiceQr: {
    type: Boolean,
    default: false,
  },
  enableWhatsappQr: {
    type: Boolean,
    default: false,
  },
  enableImei: {
    type: Boolean,
    default: false,
  },
  defaultPaymentMode: {
    type: String,
    enum: ['Cash', 'Card', 'UPI', 'Credit'],
    default: 'Cash',
  },
  bankName: {
    type: String,
    trim: true,
    default: '',
  },
  bankAccountNo: {
    type: String,
    trim: true,
    default: '',
  },
  bankIfsc: {
    type: String,
    trim: true,
    default: '',
  },
  bankAccountName: {
    type: String,
    trim: true,
    default: '',
  },
  panNumber: {
    type: String,
    trim: true,
    default: '',
  },
  defaultGstRate: {
    type: Number,
    default: 0,
  },
  enableHsnField: {
    type: Boolean,
    default: true,
  },
  enableDiscountField: {
    type: Boolean,
    default: false,
  },
  enableAutoPrint: {
    type: Boolean,
    default: false,
  },
  defaultUnit: {
    type: String,
    enum: ['pcs', 'kg'],
    default: 'pcs',
  },
  isAdmin: {
    type: Boolean,
    default: false,
  },
  isBlocked: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

// Pre-save hook to hash password
userSchema.pre('save', async function() {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare entered password with hashed password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

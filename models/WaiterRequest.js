const mongoose = require('mongoose');

const waiterRequestSchema = new mongoose.Schema({
  tenantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RestaurantTable',
    required: true,
  },
  requestType: {
    type: String,
    enum: ['Call Waiter', 'Need Water', 'Need Tissue', 'Need Spoon', 'Request Bill'],
    required: true,
  },
  status: {
    type: String,
    enum: ['Pending', 'Attended', 'Cancelled'],
    default: 'Pending',
  },
  notes: {
    type: String,
    default: '',
  }
}, { timestamps: true });

waiterRequestSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('WaiterRequest', waiterRequestSchema);

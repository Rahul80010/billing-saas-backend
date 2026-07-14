const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  category: {
    type: String,
    enum: ['Electricity', 'Rent', 'Salary', 'Transport', 'Internet', 'Marketing', 'Miscellaneous'],
    required: true,
    index: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  note: {
    type: String,
    default: '',
  },
  expenseDate: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, { timestamps: true });

module.exports = mongoose.model('Expense', expenseSchema);

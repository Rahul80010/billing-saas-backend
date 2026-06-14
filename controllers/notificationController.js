const Notification = require('../models/Notification');
const Bill = require('../models/Bill');

// @desc    Get user's notifications
// @route   GET /api/notifications
// @access  Private
const getNotifications = async (req, res) => {
  try {
    // Check and generate reminder notifications dynamically on request
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Find all pending/partial bills for the user that have a due/reminder date
      const activeCreditBills = await Bill.find({
        userId: req.user._id,
        status: { $in: ['pending', 'partial'] },
        dueDate: { $ne: null }
      });

      for (const bill of activeCreditBills) {
        const reminderDate = new Date(bill.dueDate);
        reminderDate.setHours(0, 0, 0, 0);

        // If the reminder date has arrived or passed
        if (reminderDate <= today) {
          // Check if we already created a reminder notification for this bill
          // to prevent duplicate spamming
          const existingNotif = await Notification.findOne({
            user: req.user._id,
            type: 'credit',
            title: 'Payment Reminder Alert',
            message: new RegExp(bill._id.toString(), 'i')
          });

          if (!existingNotif) {
            await Notification.create({
              user: req.user._id,
              title: 'Payment Reminder Alert',
              message: `Udhaar payment reminder for customer "${bill.customerName}" (Invoice: #INV-${bill._id.toString().substring(0, 6).toUpperCase()}, ID: ${bill._id}). Outstanding amount: ₹${bill.remainingAmount}. Set reminder date: ${reminderDate.toLocaleDateString(undefined, { dateStyle: 'medium' })}.`,
              type: 'credit'
            });
          }
        }
      }
    } catch (reminderErr) {
      console.error('Error checking reminders:', reminderErr);
    }

    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 notifications to prevent overload
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark a notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (notification) {
      notification.read = true;
      const updatedNotification = await notification.save();
      res.json(updatedNotification);
    } else {
      res.status(404).json({ message: 'Notification not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, read: false },
      { $set: { read: true } }
    );
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete a notification
// @route   DELETE /api/notifications/:id
// @access  Private
const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      user: req.user._id
    });

    if (notification) {
      await notification.deleteOne();
      res.json({ message: 'Notification deleted successfully' });
    } else {
      res.status(404).json({ message: 'Notification not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification
};

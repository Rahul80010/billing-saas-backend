const express = require('express');
const router = express.Router();
const hotelBookingController = require('../controllers/hotelBookingController');
const { protect } = require('../middleware/authMiddleware');

router.post('/check-in', protect, hotelBookingController.checkInGuest);
router.get('/active', protect, hotelBookingController.getActiveBookings);
router.get('/history/all', protect, hotelBookingController.getBookingHistory);

// Hotel Guest Directory & 360° Order History Routes
router.get('/guests/all', protect, hotelBookingController.getHotelGuests);
router.get('/guests/:phoneOrId', protect, hotelBookingController.getHotelGuestDetails);
router.post('/guests', protect, hotelBookingController.createHotelGuest);
router.put('/guests/:id', protect, hotelBookingController.updateHotelGuest);

router.get('/:id', protect, hotelBookingController.getBookingDetails);
router.post('/:id/extra-charge', protect, hotelBookingController.addExtraCharge);
router.post('/:id/check-out', protect, hotelBookingController.checkOutGuest);
router.put('/room/:roomId/clean', protect, hotelBookingController.markRoomClean);

module.exports = router;

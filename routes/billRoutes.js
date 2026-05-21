const express = require('express');
const router = express.Router();
const {
  getBills,
  createBill,
} = require('../controllers/billController');

router.route('/').get(getBills).post(createBill);

module.exports = router;

const dns = require('dns');
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const connectDB = require('./config/db');
const path = require('path');
const http = require('http');

// Load env vars
dotenv.config();

// Connect to database
if (process.env.NODE_ENV !== 'test') {
  connectDB();
}

const app = express();
const server = http.createServer(app);

// Init Socket.io
require('./services/socketService').init(server);

// Middleware
app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Static uploads serving
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Routes
app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/variants', require('./routes/variantRoutes'));
app.use('/api/hsn', require('./routes/hsnRoutes'));
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/bills', require('./routes/billRoutes'));
app.use('/api/whatsapp', require('./routes/whatsappRoutes'));
app.use('/api/webhooks', require('./routes/webhookRoutes'));
app.use('/api/crm', require('./routes/crmRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/image-generations', require('./routes/imageGenerationRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/restaurant', require('./routes/restaurantRoutes'));
app.use('/api/stock-sharing', require('./routes/stockSharingRoutes'));
app.use('/api/gallery', require('./routes/galleryRoutes'));
app.use('/api/hotel/bookings', require('./routes/hotelBookingRoutes'));

// Basic route
app.get('/', (req, res) => {
  res.send('Billing SaaS API is running...');
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error in Route:', err);
  res.status(500).json({ message: 'Internal Server Error', error: err.message });
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Catch uncaught exceptions to prevent server from crashing entirely
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down gracefully if needed...', err);
  // Optional: process.exit(1) after logging
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down gracefully if needed...', err);
  // Optional: process.exit(1) after logging
});

module.exports = app;

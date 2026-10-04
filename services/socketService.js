const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL 
          ? [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5000']
          : '*',
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    // Authentication Middleware for WebSocket Connections
    io.use(async (socket, next) => {
      try {
        const rawToken = socket.handshake.auth?.token || 
                         socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

        if (rawToken && process.env.JWT_SECRET) {
          try {
            const decoded = jwt.verify(rawToken, process.env.JWT_SECRET);
            const User = mongoose.model('User');
            const user = await User.findById(decoded.id).select('-password');
            if (user && !user.isBlocked) {
              socket.user = user;
            }
          } catch (jwtErr) {
            // Token invalid - socket remains unauthenticated
          }
        }
        next();
      } catch (err) {
        next();
      }
    });

    io.on('connection', (socket) => {
      // Authorize Tenant / Merchant specific private channels
      socket.on('join_tenant', (tenantId) => {
        if (!tenantId) return;
        const targetTenantStr = tenantId.toString();
        const userTenantStr = socket.user?._id?.toString();

        if (socket.user && (userTenantStr === targetTenantStr || socket.user.isAdmin)) {
          socket.join(`tenant_${targetTenantStr}`);
        } else {
          socket.emit('socket_error', { message: 'Unauthorized: Cannot join private tenant channel' });
        }
      });

      socket.on('join_kitchen', (tenantId) => {
        if (!tenantId) return;
        const targetTenantStr = tenantId.toString();
        const userTenantStr = socket.user?._id?.toString();

        if (socket.user && (userTenantStr === targetTenantStr || socket.user.isAdmin)) {
          socket.join(`kitchen_${targetTenantStr}`);
        } else {
          socket.emit('socket_error', { message: 'Unauthorized: Cannot join private kitchen channel' });
        }
      });

      socket.on('join_billing', (tenantId) => {
        if (!tenantId) return;
        const targetTenantStr = tenantId.toString();
        const userTenantStr = socket.user?._id?.toString();

        if (socket.user && (userTenantStr === targetTenantStr || socket.user.isAdmin)) {
          socket.join(`billing_${targetTenantStr}`);
        } else {
          socket.emit('socket_error', { message: 'Unauthorized: Cannot join private billing channel' });
        }
      });

      // Table-specific room for live customer QR ordering status updates
      socket.on('join_table', async (tableId) => {
        if (!tableId || !mongoose.Types.ObjectId.isValid(tableId)) {
          socket.emit('socket_error', { message: 'Invalid table identifier' });
          return;
        }

        try {
          const RestaurantTable = mongoose.model('RestaurantTable');
          const tableExists = await RestaurantTable.exists({ _id: tableId });
          if (tableExists) {
            socket.join(`table_${tableId}`);
          } else {
            socket.emit('socket_error', { message: 'Table not found' });
          }
        } catch (err) {
          socket.emit('socket_error', { message: 'Failed to join table room' });
        }
      });

      socket.on('disconnect', () => {
        // Cleanup handled automatically by Socket.IO
      });
    });

    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error('Socket.io not initialized!');
    }
    return io;
  }
};

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: '*', // Allow frontend domain in production
        methods: ['GET', 'POST']
      }
    });

    // Connection Authentication Middleware
    io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          (socket.handshake.headers.authorization && socket.handshake.headers.authorization.startsWith('Bearer ')
            ? socket.handshake.headers.authorization.split(' ')[1]
            : null) ||
          socket.handshake.query?.token;

        const isGuest = socket.handshake.query?.isGuest === 'true' || socket.handshake.auth?.isGuest === true;
        const guestTableId = socket.handshake.query?.tableId || socket.handshake.auth?.tableId;

        if (token) {
          try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mohuri_jwt_fallback_secret');
            const user = await User.findById(decoded.id).select('-password');
            if (!user) {
              return next(new Error('Authentication error: User not found'));
            }
            socket.user = user;
            socket.tenantId = user._id.toString();
            return next();
          } catch (jwtErr) {
            return next(new Error('Authentication error: Invalid or expired token'));
          }
        }

        // Allow guest ordering restricted strictly to their assigned table
        if (isGuest && guestTableId) {
          socket.isGuest = true;
          socket.guestTableId = String(guestTableId);
          return next();
        }

        return next(new Error('Authentication required: Token must be provided'));
      } catch (err) {
        return next(new Error('Authentication error: Connection rejected'));
      }
    });

    io.on('connection', (socket) => {
      console.log('Authenticated client connected:', socket.id, socket.user ? `Tenant: ${socket.tenantId}` : 'Guest');

      if (socket.user) {
        // Automatically bind socket to authenticated tenant's rooms ONLY
        const tenantRoom = `tenant_${socket.tenantId}`;
        socket.join(tenantRoom);
        socket.join(`kitchen_${socket.tenantId}`);
        socket.join(`billing_${socket.tenantId}`);

        // Client events are restricted: enforce caller's verified tenantId
        socket.on('join_tenant', () => {
          socket.join(`tenant_${socket.tenantId}`);
        });

        socket.on('join_tenant_room', () => {
          socket.join(`tenant_${socket.tenantId}`);
        });

        socket.on('join_kitchen', () => {
          socket.join(`kitchen_${socket.tenantId}`);
        });

        socket.on('join_billing', () => {
          socket.join(`billing_${socket.tenantId}`);
        });

        socket.on('join_table', (tableId) => {
          socket.join(`table_${tableId}`);
        });
      } else if (socket.isGuest && socket.guestTableId) {
        // Guest can only join their table
        socket.join(`table_${socket.guestTableId}`);
      }

      socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
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

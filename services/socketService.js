const { Server } = require('socket.io');

let io;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: {
        origin: '*', // Allow frontend domain in production
        methods: ['GET', 'POST']
      }
    });

    io.on('connection', (socket) => {
      console.log('Client connected:', socket.id);

      // Join specific rooms based on role/context
      socket.on('join_tenant', (tenantId) => {
        socket.join(`tenant_${tenantId}`);
        console.log(`Socket ${socket.id} joined tenant_${tenantId}`);
      });

      socket.on('join_table', (tableId) => {
        socket.join(`table_${tableId}`);
        console.log(`Socket ${socket.id} joined table_${tableId}`);
      });
      
      socket.on('join_kitchen', (tenantId) => {
        socket.join(`kitchen_${tenantId}`);
        console.log(`Socket ${socket.id} joined kitchen_${tenantId}`);
      });

      socket.on('join_billing', (tenantId) => {
        socket.join(`billing_${tenantId}`);
        console.log(`Socket ${socket.id} joined billing_${tenantId}`);
      });

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

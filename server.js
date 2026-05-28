const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { initializeQueue } = require('./src/queues/transcription.queue');

// Initialize the queue layer (checks connection, handles fallback to in-memory mode)
initializeQueue()
  .then(() => {
    // Start the Express server
    const server = app.listen(config.PORT, () => {
      logger.info(`Server successfully started in ${config.NODE_ENV} mode on port ${config.PORT}`);
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Shutting down gracefully...');
      server.close(() => {
        logger.info('Express server closed.');
        process.exit(0);
      });
    });
  })
  .catch((err) => {
    logger.error('Failed to initialize queue system. Server failed to start.', err);
    process.exit(1);
  });

// Graceful rejection and exception handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection detected:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, err.stack);
  process.exit(1);
});

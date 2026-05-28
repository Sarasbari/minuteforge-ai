const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');

// Instantiate and start the BullMQ Worker
require('./src/queues/transcription.worker');

// Start the Express server
const server = app.listen(config.PORT, () => {
  logger.info(`Server successfully started in ${config.NODE_ENV} mode on port ${config.PORT}`);
});

// Graceful rejection and exception handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection detected:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, err.stack);
  process.exit(1);
});

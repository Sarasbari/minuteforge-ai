const multer = require('multer');
const logger = require('../utils/logger');

/**
 * Global Express Error Handling Middleware
 */
function errorMiddleware(err, req, res, next) {
  // Log error with stack trace for debugging
  logger.error(err.message, err.stack);

  // Check if headers are already sent, delegate to default express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle Multer-specific errors
  if (err instanceof multer.MulterError) {
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = 'File size limit exceeded. Maximum size allowed is 500MB.';
    }
    return res.status(400).json({ error: message });
  }

  // Handle custom status errors (like file filter validation)
  const status = err.status || 500;
  const message = err.message || 'An unexpected error occurred on the server.';

  res.status(status).json({
    error: message
  });
}

module.exports = errorMiddleware;

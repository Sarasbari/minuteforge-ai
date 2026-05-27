const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const errorMiddleware = require('./middleware/error.middleware');
const logger = require('./utils/logger');

const app = express();

// Enable Cross-Origin Resource Sharing (CORS)
app.use(cors());

// Parse incoming JSON payloads
app.use(express.json());

// Parse URL-encoded payloads
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Mount the main API routes
app.use('/', routes);

// Global Error Handler Middleware (must be registered last)
app.use(errorMiddleware);

module.exports = app;

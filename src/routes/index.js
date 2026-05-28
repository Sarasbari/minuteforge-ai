const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload.middleware');
const { handleUpload } = require('../controllers/upload.controller');
const { getJobStatus } = require('../controllers/job.controller');

/**
 * Route definitions
 */

// POST /upload: Accepts a single file in the multipart field "file"
router.post('/upload', upload.single('file'), handleUpload);

// GET /job/:id/status: Polls status of a background job
router.get('/job/:id/status', getJobStatus);

module.exports = router;

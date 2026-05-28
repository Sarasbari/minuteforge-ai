const logger = require('../utils/logger');
const { transcriptionQueue } = require('../queues/transcription.queue');

/**
 * Controller to handle POST /upload requests
 */
const handleUpload = async (req, res, next) => {
  try {
    // If multer file filter didn't fail but no file was uploaded
    if (!req.file) {
      const error = new Error('No file uploaded. Make sure the multipart field name is "file".');
      error.status = 400;
      return next(error);
    }

    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const mimetype = req.file.mimetype;

    // Log the file details
    logger.info(`Upload successful: filename="${req.file.filename}", mimetype="${mimetype}", size=${req.file.size} bytes`);

    // Add job to BullMQ queue
    const job = await transcriptionQueue.add('transcribe-job', {
      filePath,
      originalName,
      mimetype,
      uploadedAt: new Date().toISOString()
    });

    logger.info(`Enqueued transcription job "${job.id}" for file: "${originalName}"`);

    // Immediately return HTTP 202 with jobId
    return res.status(202).json({
      jobId: job.id,
      status: 'queued'
    });
  } catch (error) {
    logger.error(`Upload controller failed to enqueue job: ${error.message}`);
    const mappedError = new Error(`[Queue Enqueue Failed]: ${error.message}`);
    mappedError.status = error.status || 500;
    next(mappedError);
  }
};

module.exports = {
  handleUpload
};

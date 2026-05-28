const { getJob } = require('../queues/transcription.queue');
const logger = require('../utils/logger');

/**
 * Controller to handle GET /job/:id/status requests
 */
const getJobStatus = async (req, res, next) => {
  try {
    const { id: jobId } = req.params;
    
    // Retrieve the job from the queue layer (handles both BullMQ and In-Memory modes)
    const job = await getJob(jobId);
    
    if (!job) {
      const error = new Error(`Job with ID "${jobId}" was not found.`);
      error.status = 404;
      return next(error);
    }
    
    // Retrieve the job's state
    const state = await job.getState();
    
    // Map state to v2 client-friendly status strings
    let status = 'queued';
    
    if (state === 'active') {
      status = job.data.status || 'active';
    } else if (state === 'completed') {
      status = 'done';
    } else if (state === 'failed') {
      status = 'failed';
    } else if (state === 'waiting' || state === 'waiting-children') {
      status = 'queued';
    }
    
    // Format response
    const response = {
      jobId: job.id,
      status,
      progress: job.progress,
      result: state === 'completed' ? job.returnvalue : null,
      error: state === 'failed' ? job.failedReason : null
    };
    
    return res.status(200).json(response);
  } catch (error) {
    logger.error(`Failed to retrieve job status: ${error.message}`);
    next(error);
  }
};

module.exports = {
  getJobStatus
};

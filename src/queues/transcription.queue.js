const { Queue, Worker, Job } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let useRedis = false;
let transcriptionQueue = null;
let connection = null;
let workerInstance = null;

const inMemoryJobs = new Map();
let jobCounter = 0;
let jobProcessor = null;

function setProcessor(processor) {
  jobProcessor = processor;
}

class InMemoryJob {
  constructor(id, data) {
    this.id = id;
    this.data = data;
    this.progress = 0;
    this.state = 'waiting';
    this.returnvalue = null;
    this.failedReason = null;
  }

  async getState() {
    return this.state;
  }

  async updateProgress(progress) {
    this.progress = progress;
  }

  async updateData(newData) {
    this.data = newData;
  }
}

/**
 * Checks Redis connectivity and configures connection options or falls back to In-Memory queue.
 */
async function initializeQueue() {
  const redisUrl = config.UPSTASH_REDIS_URL;
  const redisToken = config.UPSTASH_REDIS_TOKEN;

  if (redisUrl) {
    logger.info('UPSTASH_REDIS_URL is configured. Initializing Upstash Redis...');
    useRedis = true;
  } else {
    logger.info('Checking if local Redis is running on port 6379...');
    const tempClient = new IORedis({
      host: '127.0.0.1',
      port: 6379,
      connectTimeout: 1000,
      lazyConnect: true,
      maxRetriesPerRequest: null
    });

    try {
      await tempClient.connect();
      logger.info('Local Redis instance detected on port 6379. Using BullMQ queue.');
      useRedis = true;
      await tempClient.disconnect();
    } catch (err) {
      logger.warn('Local Redis is not running and UPSTASH_REDIS_URL is not set. Falling back to In-Memory Queue.');
      useRedis = false;
      await tempClient.disconnect();
    }
  }

  // Import worker processor logic
  const { workerProcessor } = require('./transcription.worker');

  if (useRedis) {
    const redisOpts = {
      maxRetriesPerRequest: null
    };

    let finalUrl = redisUrl;
    if (redisUrl) {
      if (redisToken && !redisUrl.includes(redisToken)) {
        if (redisUrl.startsWith('redis://') || redisUrl.startsWith('rediss://')) {
          const cleanUrl = redisUrl.replace(/^(redis:\/\/|rediss:\/\/)/, '');
          const prefix = redisUrl.startsWith('rediss://') ? 'rediss://' : 'redis://';
          finalUrl = `${prefix}default:${redisToken}@${cleanUrl}`;
        } else {
          finalUrl = `rediss://default:${redisToken}@${redisUrl}`;
        }
      }
      if (finalUrl.startsWith('rediss://')) {
        redisOpts.tls = { rejectUnauthorized: false };
      }
      connection = new IORedis(finalUrl, redisOpts);
    } else {
      connection = new IORedis({
        host: '127.0.0.1',
        port: 6379,
        ...redisOpts
      });
    }

    connection.on('error', (err) => {
      logger.error(`Redis connection error: ${err.message}`);
    });

    transcriptionQueue = new Queue('transcription', { connection });
    
    // Start BullMQ Worker
    workerInstance = new Worker('transcription', workerProcessor, { connection });
    workerInstance.on('failed', (job, err) => {
      logger.error(`Worker job "${job ? job.id : 'unknown'}" failed with error: ${err.message}`);
    });
  } else {
    // Configure local in-memory worker processor
    setProcessor(workerProcessor);
  }
}

/**
 * Enqueues a new background job.
 */
async function addJob(jobName, data) {
  if (useRedis && transcriptionQueue) {
    return await transcriptionQueue.add(jobName, data);
  } else {
    jobCounter++;
    const jobId = String(jobCounter);
    const inMemoryJob = new InMemoryJob(jobId, data);
    inMemoryJobs.set(jobId, inMemoryJob);

    // Run execution asynchronously in next tick of event loop
    setImmediate(async () => {
      logger.info(`[In-Memory Queue]: Starting execution of job "${jobId}"...`);
      inMemoryJob.state = 'active';
      try {
        if (jobProcessor) {
          const result = await jobProcessor(inMemoryJob);
          inMemoryJob.state = 'completed';
          inMemoryJob.returnvalue = result;
          inMemoryJob.progress = 100;
        } else {
          throw new Error('No job processor registered.');
        }
      } catch (err) {
        logger.error(`[In-Memory Queue]: Job "${jobId}" failed: ${err.message}`);
        inMemoryJob.state = 'failed';
        inMemoryJob.failedReason = err.message;
      }
    });

    return inMemoryJob;
  }
}

/**
 * Retrieves a job by ID.
 */
async function getJob(jobId) {
  if (useRedis && transcriptionQueue) {
    try {
      return await Job.fromId(transcriptionQueue, jobId);
    } catch (err) {
      logger.error(`Failed to retrieve job "${jobId}" from BullMQ: ${err.message}`);
      return null;
    }
  } else {
    return inMemoryJobs.get(jobId) || null;
  }
}

module.exports = {
  initializeQueue,
  addJob,
  getJob
};

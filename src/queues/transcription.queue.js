const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let connection;

const redisUrl = config.UPSTASH_REDIS_URL;
const redisToken = config.UPSTASH_REDIS_TOKEN;

const redisOpts = {
  maxRetriesPerRequest: null
};

if (redisUrl) {
  logger.info('Initializing Upstash Redis connection using URL...');
  
  let finalUrl = redisUrl;
  
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
    redisOpts.tls = {
      rejectUnauthorized: false
    };
  }
  
  connection = new IORedis(finalUrl, redisOpts);
} else {
  logger.warn('UPSTASH_REDIS_URL is not set. Falling back to local Redis connection.');
  connection = new IORedis({
    host: '127.0.0.1',
    port: 6379,
    ...redisOpts
  });
}

connection.on('connect', () => {
  logger.info('Successfully connected to Redis instance.');
});

connection.on('error', (err) => {
  logger.error(`Redis connection error: ${err.message}`);
});

const transcriptionQueue = new Queue('transcription', { connection });

module.exports = {
  transcriptionQueue,
  connectionOptions: connection
};

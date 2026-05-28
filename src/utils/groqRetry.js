const Groq = require('groq-sdk');
const config = require('../config');
const logger = require('./logger');

const groq = new Groq({
  apiKey: config.GROQ_API_KEY
});

/**
 * Calls Groq completion endpoint with retry handling using exponential backoff and jitter.
 * 
 * @param {object} params - Parameters for the Groq API call
 * @param {number} attempt - Current attempt count (default: 1)
 * @returns {Promise<object>} - Groq API response
 */
async function callGroqWithRetry(params, attempt = 1) {
  const maxAttempts = 5;
  const baseDelay = 2000; // 2 seconds
  const maxDelay = 30000; // 30 seconds

  try {
    const response = await groq.chat.completions.create(params);
    return response;
  } catch (error) {
    const isRateLimit = error.status === 429 || 
                        error.statusCode === 429 || 
                        (error.message && error.message.includes('429')) ||
                        (error.message && error.message.toLowerCase().includes('rate limit'));

    if (isRateLimit && attempt < maxAttempts) {
      // Formula: wait = min(baseDelay * 2^attempt + random(0, 1000ms), maxDelay)
      const delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
      
      logger.warn(`Groq rate limit hit (429). Attempt ${attempt}/${maxAttempts}. Retrying in ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return callGroqWithRetry(params, attempt + 1);
    }

    logger.error(`Groq API call failed on attempt ${attempt}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  callGroqWithRetry,
  groq
};

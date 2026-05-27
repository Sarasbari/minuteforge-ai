const fs = require('fs').promises;
const logger = require('./logger');

/**
 * Safely deletes a file at the given absolute or relative path.
 * Logs a message if deletion fails or succeeds.
 * @param {string} filePath - Path to the file to delete
 * @returns {Promise<boolean>} - True if deleted successfully, false otherwise
 */
async function deleteFile(filePath) {
  if (!filePath) return false;
  try {
    await fs.unlink(filePath);
    logger.info(`Successfully deleted temporary file: ${filePath}`);
    return true;
  } catch (err) {
    // If the file does not exist, that's fine, we don't need to throw
    if (err.code === 'ENOENT') {
      logger.debug(`File not found for cleanup: ${filePath}`);
    } else {
      logger.error(`Failed to delete temporary file: ${filePath}`, err);
    }
    return false;
  }
}

module.exports = {
  deleteFile
};

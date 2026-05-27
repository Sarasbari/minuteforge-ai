const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const path = require('path');
const logger = require('../utils/logger');

// Set the ffmpeg path from the ffmpeg installer
ffmpeg.setFfmpegPath(ffmpegPath);

/**
 * Checks if the file is an .mp4 video. If so, extracts the audio track 
 * and saves it to a .m4a file in the uploads directory.
 * If the file is not .mp4, it returns the inputPath unchanged.
 * 
 * @param {string} inputPath - Absolute path to the uploaded file
 * @returns {Promise<string>} - Absolute path to the file to be processed (either the original file or the extracted audio file)
 */
function extractAudio(inputPath) {
  return new Promise((resolve, reject) => {
    try {
      const ext = path.extname(inputPath).toLowerCase();
      if (ext !== '.mp4') {
        logger.info(`Skipping audio extraction. File extension is "${ext}" (not ".mp4").`);
        return resolve(inputPath);
      }

      const dir = path.dirname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const outputPath = path.join(dir, `${baseName}-audio.m4a`);

      logger.info(`Starting audio extraction: "${inputPath}" -> "${outputPath}"`);

      ffmpeg(inputPath)
        .output(outputPath)
        .noVideo()
        .audioCodec('aac')
        .on('start', (commandLine) => {
          logger.debug(`FFmpeg executed command: ${commandLine}`);
        })
        .on('error', (err) => {
          logger.error(`Error occurred during audio extraction for "${inputPath}"`, err);
          reject(err);
        })
        .on('end', () => {
          logger.info(`Audio extraction completed successfully: "${outputPath}"`);
          resolve(outputPath);
        })
        .run();
    } catch (error) {
      logger.error('Failed to initialize audio extraction', error);
      reject(error);
    }
  });
}

module.exports = {
  extractAudio
};

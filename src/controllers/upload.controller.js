const logger = require('../utils/logger');
const ffmpegService = require('../services/ffmpeg.service');
const transcriptionService = require('../services/transcription.service');
const cleanup = require('../utils/cleanup');

/**
 * Controller to handle POST /upload requests
 */
const handleUpload = async (req, res, next) => {
  let originalFilePath = null;
  let audioFilePath = null;

  try {
    // If multer file filter didn't fail but no file was uploaded (e.g. wrong form field name)
    if (!req.file) {
      const error = new Error('No file uploaded. Make sure the multipart field name is "file".');
      error.status = 400;
      return next(error);
    }

    originalFilePath = req.file.path;
    audioFilePath = originalFilePath;

    // Log the file details
    logger.info(`Upload successful: filename="${req.file.filename}", mimetype="${req.file.mimetype}", size=${req.file.size} bytes`);

    // 1. Run FFmpeg extraction if file is MP4
    audioFilePath = await ffmpegService.extractAudio(originalFilePath);

    // 2. Call AssemblyAI transcription service
    const transcriptionResult = await transcriptionService.transcribe(audioFilePath);

    // 3. Log the first 200 characters of the transcript
    const excerpt = transcriptionResult.transcript.substring(0, 200);
    logger.info(`Transcription successful! Transcript Excerpt (200 chars):\n"${excerpt}${transcriptionResult.transcript.length > 200 ? '...' : ''}"`);

    // Return success response (still return success and filename for now)
    res.status(200).json({
      success: true,
      filename: req.file.filename
    });
  } catch (error) {
    logger.error(`Upload controller failed: ${error.message}`);
    next(error);
  } finally {
    // Asynchronously delete temporary files to avoid disk leaks
    if (originalFilePath) {
      cleanup.deleteFile(originalFilePath);
    }
    if (audioFilePath && audioFilePath !== originalFilePath) {
      cleanup.deleteFile(audioFilePath);
    }
  }
};

module.exports = {
  handleUpload
};

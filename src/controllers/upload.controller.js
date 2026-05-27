const logger = require('../utils/logger');
const ffmpegService = require('../services/ffmpeg.service');
const transcriptionService = require('../services/transcription.service');
const extractionService = require('../services/extraction.service');
const notionService = require('../services/notion.service');
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
    try {
      audioFilePath = await ffmpegService.extractAudio(originalFilePath);
    } catch (error) {
      throw new Error(`[Audio Extraction Failed]: ${error.message}`);
    }

    // 2. Call AssemblyAI transcription service
    let transcriptionResult;
    try {
      transcriptionResult = await transcriptionService.transcribe(audioFilePath);
    } catch (error) {
      throw new Error(`[Transcription Failed]: ${error.message}`);
    }

    // 3. Run Groq summary and action items extraction
    let extractionResult;
    try {
      extractionResult = await extractionService.extract(transcriptionResult.transcript, transcriptionResult.speakers);
    } catch (error) {
      throw new Error(`[Summary Extraction Failed]: ${error.message}`);
    }

    // 4. Create Notion meeting page
    let notionResult;
    try {
      notionResult = await notionService.createMeetingPage({
        extraction: extractionResult,
        transcript: transcriptionResult.transcript,
        speakers: transcriptionResult.speakers
      });
    } catch (error) {
      throw new Error(`[Notion Publish Failed]: ${error.message}`);
    }

    // Return success response with the Notion page URL
    res.status(200).json({
      success: true,
      notionUrl: notionResult.url
    });
  } catch (error) {
    logger.error(`Upload controller failed: ${error.message}`);
    // If error doesn't have a specific step label, add a generic controller label
    const mappedMessage = error.message.startsWith('[') ? error.message : `[Upload Controller Failed]: ${error.message}`;
    const mappedError = new Error(mappedMessage);
    mappedError.status = error.status || 500;
    next(mappedError);
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

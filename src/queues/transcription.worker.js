const logger = require('../utils/logger');
const ffmpegService = require('../services/ffmpeg.service');
const transcriptionService = require('../services/transcription.service');
const speakerMapService = require('../services/speakerMap.service');
const extractionService = require('../services/extraction.service');
const notionService = require('../services/notion.service');
const cleanup = require('../utils/cleanup');

/**
 * Common processor logic shared between BullMQ and In-Memory queue modes.
 */
const workerProcessor = async (job) => {
  const { filePath, originalName, mimetype, uploadedAt } = job.data;
  let originalFilePath = filePath;
  let audioFilePath = filePath;

  logger.info(`Worker picked up job "${job.id}" for file: "${originalName}"`);

  try {
    // 1. Audio Extraction (if applicable)
    logger.info(`Job "${job.id}": Starting audio extraction...`);
    await job.updateProgress(10);
    await job.updateData({ ...job.data, status: 'transcribing' });
    
    try {
      audioFilePath = await ffmpegService.extractAudio(originalFilePath);
    } catch (error) {
      throw new Error(`Audio extraction failed: ${error.message}`);
    }

    // 2. Transcription via AssemblyAI
    logger.info(`Job "${job.id}": Submitting audio to AssemblyAI for transcription...`);
    await job.updateProgress(30);
    
    let transcriptionResult;
    try {
      transcriptionResult = await transcriptionService.transcribe(audioFilePath);
    } catch (error) {
      throw new Error(`AssemblyAI transcription failed: ${error.message}`);
    }

    // 3. Speaker Name Resolution
    logger.info(`Job "${job.id}": Running speaker name resolution...`);
    await job.updateProgress(50);
    await job.updateData({ ...job.data, status: 'mapping_speakers' });

    let finalTranscript = transcriptionResult.transcript;
    let finalSpeakers = transcriptionResult.speakers;

    try {
      const mapping = await speakerMapService.resolveSpeakerNames(transcriptionResult.speakers);
      finalTranscript = speakerMapService.applyMapping(transcriptionResult.transcript, mapping);
      finalSpeakers = speakerMapService.applyMappingToSpeakers(transcriptionResult.speakers, mapping);
    } catch (error) {
      logger.warn(`Job "${job.id}": Speaker mapping failed, proceeding with generic IDs: ${error.message}`);
    }

    // 4. Extraction via Groq
    logger.info(`Job "${job.id}": Running AI extraction on transcript...`);
    await job.updateProgress(70);
    await job.updateData({ ...job.data, status: 'extracting' });
    
    let extractionResult;
    try {
      const meetingDate = uploadedAt ? uploadedAt.split('T')[0] : new Date().toISOString().split('T')[0];
      extractionResult = await extractionService.extract(finalTranscript, finalSpeakers, meetingDate);
    } catch (error) {
      throw new Error(`Groq extraction failed: ${error.message}`);
    }

    // 5. Publish to Notion
    logger.info(`Job "${job.id}": Publishing meeting page to Notion...`);
    await job.updateProgress(90);
    await job.updateData({ ...job.data, status: 'writing_notion' });
    
    let notionResult;
    try {
      notionResult = await notionService.createMeetingPage({
        extraction: extractionResult,
        transcript: finalTranscript,
        speakers: finalSpeakers
      });
    } catch (error) {
      throw new Error(`Notion publish failed: ${error.message}`);
    }

    await job.updateProgress(100);
    logger.info(`Job "${job.id}" processing completed successfully. Notion URL: ${notionResult.url}`);
    
    return { notionUrl: notionResult.url };
  } catch (error) {
    logger.error(`Worker execution failed for job "${job.id}": ${error.message}`);
    throw error;
  } finally {
    logger.info(`Job "${job.id}": Starting cleanup of temporary files...`);
    if (originalFilePath) {
      await cleanup.deleteFile(originalFilePath);
    }
    if (audioFilePath && audioFilePath !== originalFilePath) {
      await cleanup.deleteFile(audioFilePath);
    }
  }
};

module.exports = {
  workerProcessor
};

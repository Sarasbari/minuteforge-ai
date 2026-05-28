const { AssemblyAI } = require('assemblyai');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize the AssemblyAI client using the configured API key
const client = new AssemblyAI({
  apiKey: config.ASSEMBLYAI_API_KEY
});

/**
 * Uploads and transcribes a local file using the AssemblyAI Node SDK.
 * Enables speaker labels (diarization) and polls for completion.
 * 
 * @param {string} filePath - Absolute path to the local audio/video file
 * @returns {Promise<{transcript: string, speakers: Array<{speaker: string, text: string, start: number, end: number}>}>}
 */
async function transcribe(filePath) {
  // Validate configuration before making calls
  if (!config.ASSEMBLYAI_API_KEY || config.ASSEMBLYAI_API_KEY.includes('your_assemblyai_api_key')) {
    const errorMsg = 'AssemblyAI API Key is not configured. Please set a valid ASSEMBLYAI_API_KEY in your .env file.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  logger.info(`Preparing to upload and transcribe: "${filePath}"`);

  // Submit the transcription job (handles local file upload automatically under the hood)
  logger.info('Uploading local file to AssemblyAI host and creating transcription job...');
  const submission = await client.transcripts.submit({
    audio: filePath,
    speaker_labels: true,
    speakers_expected: null,
    speech_models: ['universal-3-pro', 'universal-2']
  });

  const transcriptId = submission.id;
  logger.info(`AssemblyAI transcription job submitted successfully. Job ID: "${transcriptId}"`);

  const startTime = Date.now();
  const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes in milliseconds
  const POLL_INTERVAL_MS = 3000; // 3 seconds in milliseconds

  // Polling loop
  while (true) {
    // Check timeout
    if (Date.now() - startTime > TIMEOUT_MS) {
      const timeoutError = new Error(`AssemblyAI transcription timed out after 10 minutes. Job ID: "${transcriptId}".`);
      timeoutError.status = 504; // Gateway Timeout
      throw timeoutError;
    }

    logger.info(`Polling transcription job status for ID: "${transcriptId}"...`);
    const statusCheck = await client.transcripts.get(transcriptId);

    if (statusCheck.status === 'completed') {
      logger.info(`Transcription completed for Job ID: "${transcriptId}"`);

      // Format speaker utterances list
      const speakers = (statusCheck.utterances || []).map((utterance) => ({
        speaker: utterance.speaker,
        text: utterance.text,
        start: utterance.start,
        end: utterance.end
      }));

      return {
        transcript: statusCheck.text || '',
        speakers
      };
    } else if (statusCheck.status === 'error') {
      const apiError = new Error(`AssemblyAI transcription failed: ${statusCheck.error}`);
      apiError.status = 500;
      throw apiError;
    }

    logger.debug(`Job "${transcriptId}" is currently in state: "${statusCheck.status}". Retrying in 3 seconds...`);
    // Wait for the next poll interval
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

module.exports = {
  transcribe
};

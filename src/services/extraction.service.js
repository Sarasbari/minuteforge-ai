const Groq = require('groq-sdk');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize the Groq client
const groq = new Groq({
  apiKey: config.GROQ_API_KEY
});

// JSON Output Scheme expectation
const EXTRACTION_SYSTEM_PROMPT = `You are a professional meeting minutes generator. Your task is to analyze the provided transcript of a meeting (which may be a chunk of a longer meeting) and extract structured information.
You MUST return your response as a valid JSON object ONLY. Do not include any conversational filler, intro, outro, markdown block wrappers (such as \`\`\`json), or HTML.
The JSON structure must match this schema exactly:
{
  "title": "A concise title summarizing the meeting subject",
  "summary": "A detailed high-level summary paragraph of what was discussed",
  "attendees": ["Attendee Name 1", "Attendee Name 2"],
  "keyDecisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {
      "owner": "Name of the person assigned (or 'Unassigned')",
      "task": "Description of the task",
      "deadline": "Deadline timeframe or date (or 'None')"
    }
  ],
  "openQuestions": ["Question 1", "Question 2"]
}`;

const MERGE_SYSTEM_PROMPT = `You are an expert secretary and editor. You are given a list of JSON meeting summaries extracted from different overlapping chunks of the same long meeting.
Your task is to merge, consolidate, and deduplicate these summaries into a single final unified JSON meeting summary.
You MUST return your response as a valid JSON object ONLY. Do not include any conversational filler, intro, outro, markdown block wrappers (such as \`\`\`json), or HTML.
The final JSON structure must match this schema exactly:
{
  "title": "A unified, concise title for the entire meeting",
  "summary": "A consolidated, coherent, high-level summary paragraph of the entire meeting",
  "attendees": ["Attendee Name 1", "Attendee Name 2"],
  "keyDecisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {
      "owner": "Name of the person assigned (or 'Unassigned')",
      "task": "Description of the task",
      "deadline": "Deadline timeframe or date (or 'None')"
    }
  ],
  "openQuestions": ["Question 1", "Question 2"]
}
Make sure you deduplicate similar decisions, action items, and open questions across the chunks. Compile a union of all attendees. Make sure the overall summary is written as a single, coherent narrative.`;

/**
 * Robustly parses a JSON string, handling potential markdown wrappers
 * @param {string} rawString 
 * @returns {object}
 */
function parseJSONResponse(rawString) {
  const trimmed = rawString.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // Try to strip out markdown JSON block if present
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = trimmed.match(codeBlockRegex);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch (innerError) {
        // Fallback to throw original
      }
    }
    throw new Error(`Failed to parse Groq response as JSON. Output was: "${rawString}"`);
  }
}

/**
 * Calls Groq completion endpoint with built-in retry handling for rate limits (429).
 * If a 429 is encountered, it waits 10 seconds and retries up to 3 times.
 */
async function callGroqWithRetry(params, attempt = 1) {
  const maxRetries = 3;
  const delayMs = 10000;

  try {
    const response = await groq.chat.completions.create(params);
    return response;
  } catch (error) {
    const isRateLimit = error.status === 429 || 
                        error.statusCode === 429 || 
                        (error.message && error.message.includes('429')) ||
                        (error.message && error.message.toLowerCase().includes('rate limit'));

    if (isRateLimit && attempt <= maxRetries) {
      logger.warn(`Groq rate limit hit (429). Attempt ${attempt}/${maxRetries}. Retrying in ${delayMs / 1000} seconds...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return callGroqWithRetry(params, attempt + 1);
    }

    logger.error(`Groq API call failed on attempt ${attempt}: ${error.message}`);
    throw error;
  }
}

/**
 * Splits formatted transcript text into overlapping chunks if it exceeds 6000 words.
 * Chunk size: 4000 words, Overlap: 200 words.
 */
function chunkTranscript(text) {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  
  // Word count limit check
  if (words.length <= 6000) {
    return [text];
  }

  const chunks = [];
  const chunkSize = 4000;
  const overlap = 200;
  let i = 0;

  while (i < words.length) {
    const chunkWords = words.slice(i, i + chunkSize);
    chunks.push(chunkWords.join(' '));

    if (i + chunkSize >= words.length) {
      break;
    }
    i += (chunkSize - overlap);
  }

  logger.info(`Transcript of length ${words.length} words split into ${chunks.length} overlapping chunks.`);
  return chunks;
}

/**
 * Extracts meeting title, summary, attendees, key decisions, action items, and open questions
 * from a transcript. Handles large files by chunking and merging.
 * 
 * @param {string} transcript - The raw text transcript
 * @param {Array<{speaker: string, text: string, start: number, end: number}>} speakers - Speaker turns
 * @returns {Promise<object>} - Unified JSON metadata
 */
async function extract(transcript, speakers) {
  if (!config.GROQ_API_KEY || config.GROQ_API_KEY.includes('your_groq_api_key')) {
    const err = new Error('Groq API Key is not configured. Please set the GROQ_API_KEY in your .env file.');
    logger.error(err.message);
    throw err;
  }

  // 1. Reconstruct speaker-attributed transcript if data exists
  let formattedTranscript = '';
  if (speakers && speakers.length > 0) {
    formattedTranscript = speakers.map(s => `Speaker ${s.speaker}: ${s.text}`).join('\n');
  } else {
    formattedTranscript = transcript || '';
  }

  // 2. Split into overlapping chunks if needed
  const chunks = chunkTranscript(formattedTranscript);

  // 3. Process each chunk
  const chunkSummaries = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunkText = chunks[index];
    logger.info(`Analyzing transcript chunk ${index + 1}/${chunks.length}...`);

    const payload = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: `Here is the meeting transcript content to analyze:\n\n${chunkText}` }
      ],
      response_format: { type: 'json_object' }
    };

    const completion = await callGroqWithRetry(payload);
    const content = completion.choices[0].message.content;
    const jsonOutput = parseJSONResponse(content);
    chunkSummaries.push(jsonOutput);
  }

  // 4. Merge results if there was more than one chunk
  if (chunkSummaries.length === 1) {
    logger.info('Single chunk processing completed successfully.');
    return chunkSummaries[0];
  }

  logger.info(`Merging ${chunkSummaries.length} chunk summaries into a single deduplicated result...`);
  const mergePayload = {
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: MERGE_SYSTEM_PROMPT },
      { role: 'user', content: `Here is the list of JSON summaries to merge and consolidate:\n\n${JSON.stringify(chunkSummaries, null, 2)}` }
    ],
    response_format: { type: 'json_object' }
  };

  const mergeCompletion = await callGroqWithRetry(mergePayload);
  const finalContent = mergeCompletion.choices[0].message.content;
  return parseJSONResponse(finalContent);
}

module.exports = {
  extract
};

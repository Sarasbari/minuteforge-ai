const { callGroqWithRetry } = require('../utils/groqRetry');
const config = require('../config');
const logger = require('../utils/logger');

const EXTRACTION_SYSTEM_PROMPT = `You are a meeting analyst. Extract structured information from the transcript below.
The meeting took place on: {{MEETING_DATE}} (ISO 8601).

Rules:
- Respond ONLY with valid JSON. No preamble, no markdown fences.
- For action item owners: read surrounding context carefully.
  If ambiguous, write 'PersonA / PersonB'. Never write 'Unassigned'.
- For deadlines: resolve ALL relative dates to ISO 8601 using the meeting date above.
  ('next Friday' from a Monday = calculate the actual date).
  If no deadline exists or cannot be resolved, output null.
- keyDecisions: only include explicitly agreed decisions, not suggestions.
- openQuestions: items raised but not resolved in the meeting.

Output schema:
{
  "title": string,
  "summary": string (2-3 sentences),
  "attendees": string[],
  "keyDecisions": string[],
  "actionItems": [{ "owner": string, "task": string, "deadline": string|null }],
  "openQuestions": string[]
}`;

const MERGE_SYSTEM_PROMPT = `You are an expert secretary and editor. You are given a list of JSON meeting summaries extracted from different overlapping chunks of the same long meeting.
Your task is to merge, consolidate, and deduplicate these summaries into a single final unified JSON meeting summary.
You MUST return your response as a valid JSON object ONLY. Do not include any conversational filler, intro, outro, markdown block wrappers (such as \`\`\`json), or HTML.
The final JSON structure must match this schema exactly:
{
  "title": "A unified, concise title for the entire meeting",
  "summary": "A consolidated, coherent, high-level summary paragraph of the entire meeting (2-3 sentences)",
  "attendees": ["Attendee Name 1", "Attendee Name 2"],
  "keyDecisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {
      "owner": "Name of the person assigned or 'PersonA / PersonB'",
      "task": "Description of the task",
      "deadline": "ISO 8601 Date or null"
    }
  ],
  "openQuestions": ["Question 1", "Question 2"]
}`;

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
 * Computes the Levenshtein distance between two strings.
 */
function getLevenshteinDistance(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1  // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Returns similarity ratio between 0.0 and 1.0.
 */
function getStringSimilarity(a, b) {
  const cleanA = a.toLowerCase().trim();
  const cleanB = b.toLowerCase().trim();
  const distance = getLevenshteinDistance(cleanA, cleanB);
  const maxLength = Math.max(cleanA.length, cleanB.length);
  if (maxLength === 0) return 1.0;
  return 1.0 - (distance / maxLength);
}

/**
 * Deduplicates tasks and decisions from the final merged JSON object.
 */
function deduplicateResults(mergedJson) {
  // 1. Deduplicate action items with identical task text (case-insensitive)
  if (mergedJson.actionItems && Array.isArray(mergedJson.actionItems)) {
    const uniqueActionItems = [];
    const seenTasks = new Set();
    
    for (const item of mergedJson.actionItems) {
      if (!item || !item.task) continue;
      const normalizedTask = item.task.toLowerCase().trim();
      if (!seenTasks.has(normalizedTask)) {
        seenTasks.add(normalizedTask);
        uniqueActionItems.push(item);
      }
    }
    mergedJson.actionItems = uniqueActionItems;
  }

  // 2. Deduplicate decisions with > 80% string similarity
  if (mergedJson.keyDecisions && Array.isArray(mergedJson.keyDecisions)) {
    const uniqueDecisions = [];
    
    for (const decision of mergedJson.keyDecisions) {
      let isDuplicate = false;
      for (const existing of uniqueDecisions) {
        if (getStringSimilarity(decision, existing) > 0.8) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        uniqueDecisions.push(decision);
      }
    }
    mergedJson.keyDecisions = uniqueDecisions;
  }
  
  return mergedJson;
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
 * @param {Array<{speaker: string, text: string}>} speakers - Speaker turns
 * @param {string} meetingDate - Meeting ISO date for relative date resolution
 * @returns {Promise<object>} - Unified JSON metadata
 */
async function extract(transcript, speakers, meetingDate) {
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
  const resolvedSystemPrompt = EXTRACTION_SYSTEM_PROMPT.replace('{{MEETING_DATE}}', meetingDate || new Date().toISOString().split('T')[0]);

  for (let index = 0; index < chunks.length; index++) {
    const chunkText = chunks[index];
    logger.info(`Analyzing transcript chunk ${index + 1}/${chunks.length}...`);

    const payload = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: resolvedSystemPrompt },
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
  let finalResult;
  if (chunkSummaries.length === 1) {
    logger.info('Single chunk processing completed successfully.');
    finalResult = chunkSummaries[0];
  } else {
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
    finalResult = parseJSONResponse(finalContent);
  }

  // 5. Run string similarity deduplication pass on final result
  logger.info('Executing post-processing deduplication pass...');
  return deduplicateResults(finalResult);
}

module.exports = {
  extract
};

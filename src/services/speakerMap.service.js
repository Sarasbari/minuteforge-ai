const { callGroqWithRetry } = require('../utils/groqRetry');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Parses a JSON string, handling potential markdown wrappers.
 */
function parseJSONResponse(rawString) {
  const trimmed = rawString.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
    const match = trimmed.match(codeBlockRegex);
    if (match) {
      try {
        return JSON.parse(match[1].trim());
      } catch (innerError) {
        // Fallback to throw
      }
    }
    throw new Error(`Failed to parse response as JSON. Output was: "${rawString}"`);
  }
}

/**
 * Infers real speaker names from the first 800 words of a diarized transcript using Groq.
 * 
 * @param {Array<{speaker: string, text: string}>} speakers - Speaker turns
 * @returns {Promise<object>} - Mapping object, e.g. { "Speaker A": "Alice Chen" }
 */
async function resolveSpeakerNames(speakers) {
  if (!config.GROQ_API_KEY || config.GROQ_API_KEY.includes('your_groq_api_key')) {
    logger.warn('Groq API Key is not configured. Skipping speaker name resolution.');
    return {};
  }

  if (!speakers || speakers.length === 0) {
    logger.info('No speaker diarization turns available. Skipping speaker name resolution.');
    return {};
  }

  try {
    // 1. Reconstruct first 800 words of the transcript with speaker prefixes
    let wordCount = 0;
    const excerptTurns = [];
    
    for (const turn of speakers) {
      const line = `Speaker ${turn.speaker}: ${turn.text}`;
      const words = turn.text.split(/\s+/).filter(w => w.length > 0);
      wordCount += words.length;
      excerptTurns.push(line);
      if (wordCount >= 800) {
        break;
      }
    }
    
    const diarisedExcerpt = excerptTurns.join('\n');
    logger.info(`Sending diarized transcript excerpt of ~${wordCount} words to Groq for speaker name resolution...`);

    const systemPrompt = `You are a transcript analyst. Given a partial meeting transcript with speaker IDs,
identify the real name of each speaker using conversational cues such as greetings,
direct address ('Hey Alice'), or self-introduction ('This is Bob').

Respond ONLY with a valid JSON object. No preamble. No explanation.
Format: { "Speaker A": "Alice Chen", "Speaker B": "Bob Patel" }
If you cannot confidently identify a speaker, use their original ID as the value.`;

    const payload = {
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcript excerpt:\n\n${diarisedExcerpt}` }
      ],
      response_format: { type: 'json_object' }
    };

    const completion = await callGroqWithRetry(payload);
    const content = completion.choices[0].message.content;
    const mapping = parseJSONResponse(content);
    
    logger.info(`Successfully resolved speaker names mapping: ${JSON.stringify(mapping)}`);
    return mapping;
  } catch (error) {
    logger.warn(`Failed to resolve speaker names: ${error.message}. Falling back to default speaker IDs.`);
    return {};
  }
}

/**
 * Performs a global search and replace of speaker ID keys with their mapped real names.
 * 
 * @param {string} fullTranscript - The raw transcript text
 * @param {object} mapping - Speaker name mapping object
 * @returns {string} - Resolved transcript text
 */
function applyMapping(fullTranscript, mapping) {
  if (!fullTranscript || !mapping || Object.keys(mapping).length === 0) {
    return fullTranscript || '';
  }

  let resolvedTranscript = fullTranscript;
  for (const [key, value] of Object.entries(mapping)) {
    if (key === value) continue; // Skip identical mappings
    
    // Escapes special regex characters in the speaker ID (e.g. "Speaker A")
    const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedKey}\\b`, 'gi');
    resolvedTranscript = resolvedTranscript.replace(regex, value);
  }
  return resolvedTranscript;
}

/**
 * Replaces the generic speaker tags in the speaker turns array with their resolved names.
 * 
 * @param {Array<{speaker: string, text: string}>} speakers - Speaker turns
 * @param {object} mapping - Speaker name mapping object
 * @returns {Array<{speaker: string, text: string}>} - Mapped speaker turns
 */
function applyMappingToSpeakers(speakers, mapping) {
  if (!speakers || speakers.length === 0 || !mapping || Object.keys(mapping).length === 0) {
    return speakers || [];
  }

  return speakers.map((turn) => {
    // Check for "Speaker A" format key matching the turn speaker label "A"
    const key = `Speaker ${turn.speaker}`;
    
    // Look up in mapping keys case-insensitively
    const matchedKey = Object.keys(mapping).find(
      k => k.toLowerCase().trim() === key.toLowerCase().trim()
    );
    
    if (matchedKey) {
      return {
        ...turn,
        speaker: mapping[matchedKey]
      };
    }
    
    return turn;
  });
}

module.exports = {
  resolveSpeakerNames,
  applyMapping,
  applyMappingToSpeakers
};

const { Client } = require('@notionhq/client');
const config = require('../config');
const logger = require('../utils/logger');

// Initialize Notion Client
const notion = new Client({
  auth: config.NOTION_API_KEY
});

/**
 * Formats a raw string into a Notion Rich Text array
 */
function formatRichText(content) {
  return [
    {
      type: 'text',
      text: {
        content: content || ''
      }
    }
  ];
}

/**
 * Splits a long string into chunks of maxChars to prevent Notion's 2,000 character limit error.
 */
function splitTextIntoChunks(text, maxChars = 1800) {
  const chunks = [];
  let index = 0;
  while (index < text.length) {
    chunks.push(text.substring(index, index + maxChars));
    index += maxChars;
  }
  return chunks;
}

/**
 * Creates a formatted meeting minutes page in the specified Notion Database.
 * 
 * @param {object} data - Object containing extraction, transcript, and speakers.
 * @returns {Promise<{ url: string }>} - Notion page URL response
 */
async function createMeetingPage(data) {
  // Validate configuration before calling Notion API
  if (!config.NOTION_API_KEY || config.NOTION_API_KEY.includes('your_notion_api_key')) {
    const errorMsg = 'Notion API Key is not configured. Please set a valid NOTION_API_KEY in your .env file.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
  if (!config.NOTION_DATABASE_ID || config.NOTION_DATABASE_ID.includes('your_notion_database_id')) {
    const errorMsg = 'Notion Database ID is not configured. Please set a valid NOTION_DATABASE_ID in your .env file.';
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  const extraction = data.extraction || {};
  const title = extraction.title || 'Untitled Meeting';
  const summary = extraction.summary || 'No summary available.';
  const attendees = extraction.attendees || [];
  const keyDecisions = extraction.keyDecisions || [];
  const actionItems = extraction.actionItems || [];
  const openQuestions = extraction.openQuestions || [];

  logger.info(`Starting Notion page generation for: "${title}"`);

  // Define children block payload
  const children = [];

  // 1. Date Callout
  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  children.push({
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: formatRichText(`Meeting Date: ${today}`),
      icon: {
        type: 'emoji',
        emoji: '📅'
      }
    }
  });

  // 2. Summary Paragraph
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: formatRichText('Summary')
    }
  });

  // Split summary into chunks if it is extremely long
  const summaryChunks = splitTextIntoChunks(summary, 1800);
  summaryChunks.forEach((chunk) => {
    children.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: formatRichText(chunk)
      }
    });
  });

  // 3. Attendees List
  if (attendees.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: formatRichText('Attendees')
      }
    });
    attendees.forEach((attendee) => {
      children.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: formatRichText(attendee)
        }
      });
    });
  }

  // 4. Key Decisions List
  if (keyDecisions.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: formatRichText('Key Decisions')
      }
    });
    keyDecisions.forEach((decision) => {
      children.push({
        object: 'block',
        type: 'numbered_list_item',
        numbered_list_item: {
          rich_text: formatRichText(decision)
        }
      });
    });
  }

  // 5. Action Items as To-Do Blocks
  if (actionItems.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: formatRichText('Action Items')
      }
    });
    actionItems.forEach((item) => {
      const ownerText = item.owner ? `[${item.owner}] ` : '';
      const deadlineText = item.deadline ? ` - (Deadline: ${item.deadline})` : '';
      children.push({
        object: 'block',
        type: 'to_do',
        to_do: {
          rich_text: formatRichText(`${ownerText}${item.task}${deadlineText}`),
          checked: false
        }
      });
    });
  }

  // 6. Open Questions List
  if (openQuestions.length > 0) {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: formatRichText('Open Questions')
      }
    });
    openQuestions.forEach((question) => {
      children.push({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: {
          rich_text: formatRichText(question)
        }
      });
    });
  }

  // 7. Toggle containing full speaker transcript
  const toggleChildren = [];
  const appendToggleText = (text) => {
    toggleChildren.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: formatRichText(text)
      }
    });
  };

  if (data.speakers && data.speakers.length > 0) {
    let currentParagraphText = '';
    for (const turn of data.speakers) {
      const line = `Speaker ${turn.speaker}: ${turn.text}\n`;
      if (line.length > 1800) {
        // Flush any existing buffered text first
        if (currentParagraphText) {
          appendToggleText(currentParagraphText.trim());
          currentParagraphText = '';
        }
        // Split this long line into smaller chunks and append individually
        const lineChunks = splitTextIntoChunks(line, 1800);
        lineChunks.forEach(chunk => appendToggleText(chunk.trim()));
      } else if (currentParagraphText.length + line.length > 1800) {
        appendToggleText(currentParagraphText.trim());
        currentParagraphText = line;
      } else {
        currentParagraphText += line;
      }
    }
    if (currentParagraphText) {
      appendToggleText(currentParagraphText.trim());
    }
  } else if (data.transcript) {
    const transcriptChunks = splitTextIntoChunks(data.transcript, 1800);
    transcriptChunks.forEach(chunk => appendToggleText(chunk));
  } else {
    appendToggleText('No transcript text available.');
  }

  // Notion limits Toggle Children up to 100 blocks
  const cappedToggleChildren = toggleChildren.slice(0, 95);

  children.push({
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: formatRichText('Full Speaker-Labelled Transcript'),
      children: cappedToggleChildren
    }
  });

  // Notion limits Page creation blocks up to 100 blocks
  const cappedChildren = children.slice(0, 95);

  // Send create request to Notion
  const response = await notion.pages.create({
    parent: {
      database_id: config.NOTION_DATABASE_ID
    },
    properties: {
      Name: {
        title: formatRichText(title)
      }
    },
    children: cappedChildren
  });

  logger.info(`Notion page successfully published. URL: "${response.url}"`);
  return {
    url: response.url
  };
}

module.exports = {
  createMeetingPage
};

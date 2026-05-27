const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

module.exports = {
  PORT: process.env.PORT || 3000,
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  NOTION_API_KEY: process.env.NOTION_API_KEY,
  NOTION_DATABASE_ID: process.env.NOTION_DATABASE_ID,
  NODE_ENV: process.env.NODE_ENV || 'development'
};

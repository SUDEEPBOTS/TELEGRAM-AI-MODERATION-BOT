// /api/bot.js

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Local modules
const db = require('../src/database/mongodb');   // 👈 DB helper instance (no destructuring)
const { setupBot } = require('../src/bot/setup');
const logger = require('../src/utils/logger');
const { startAllJobs } = require('../src/utils/cronJobs');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Telegram Bot (no polling, webhook only)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false
});

// Setup bot handlers
setupBot(bot);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Telegram AI Moderation Bot',
    version: '1.0.0'
  });
});

// 👇 DEBUG + browser check: GET /webhook
app.get('/webhook', (req, res) => {
  logger.info('GET /webhook hit (browser/health)');
  res.status(200).send('Webhook endpoint is alive (GET). Use POST from Telegram.');
});

// Webhook endpoint (Telegram yaha POST karega)
app.post('/webhook', async (req, res) => {
  try {
    logger.info('POST /webhook update received');
    const update = req.body;
    await bot.processUpdate(update);
    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Error processing update');
  }
});

// Webhook + DB + cron jobs init
async function init() {
  try {
    // DB connect
    await db.connect();
    logger.info('MongoDB connected from init()');

    // Webhook URL env se
    const baseUrl =
      process.env.TELEGRAM_WEBHOOK_URL ||
      'https://telegram-ai-moderation-bot.vercel.app/api/bot';

    const webhookUrl = `${baseUrl}/webhook`;

    await bot.setWebHook(webhookUrl);
    logger.info(`Webhook set to: ${webhookUrl}`);

    // Commands
    await bot.setMyCommands([
      { command: 'ping', description: 'Check bot latency' },
      { command: 'stats', description: 'Get bot statistics' },
      { command: 'refresh', description: 'Refresh bot cache' },
      { command: 'setrules', description: 'Set group rules' },
      { command: 'approve', description: 'Approve user to ignore list' },
      { command: 'ban', description: 'Ban a user' },
      { command: 'mute', description: 'Mute a user' },
      { command: 'warn', description: 'Warn a user' },
      { command: 'unban', description: 'Unban a user' },
      { command: 'unmute', description: 'Unmute a user' }
    ]);

    logger.info('Bot commands set successfully');

    // Cron jobs
    startAllJobs(bot);
    logger.info('Cron jobs started');
  } catch (error) {
    logger.error('Error in init():', error);
  }
}

// Vercel par sirf init call, listen nahi
init();

// Local development ke liye (agar kabhi Node se run karo)
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Local server running on port ${PORT}`);
  });
}

// Export for Vercel
module.exports = app;

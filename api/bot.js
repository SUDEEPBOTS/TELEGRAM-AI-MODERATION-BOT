// /api/bot.js

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Local modules
const db = require('../src/database/mongodb');      // ✅ sahi import
const { setupBot } = require('../src/bot/setup');
const logger = require('../src/utils/logger');
const { startAllJobs } = require('../src/utils/cronJobs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
  webHook: {
    host: '0.0.0.0',
    port: PORT
  }
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Telegram AI Moderation Bot',
    version: '1.0.0'
  });
});

// 🔹 Telegram test ke liye GET /webhook bhi OK return kare
app.get('/webhook', (req, res) => {
  res.status(200).send('OK');
});

// Webhook endpoint (Telegram yaha POST karega)
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    logger.info('Incoming update', { update });  // optional logging
    await bot.processUpdate(update);
    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Error processing update');
  }
});

// Setup bot handlers
setupBot(bot);

// Set webhook on startup
async function setWebhook() {
  try {
    const webhookUrl = `${process.env.TELEGRAM_WEBHOOK_URL}/webhook`;
    await bot.setWebHook(webhookUrl);
    logger.info(`Webhook set to: ${webhookUrl}`);

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
  } catch (error) {
    logger.error('Error setting webhook:', error);
  }
}

// Start server
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);

  // Set webhook
  await setWebhook();

  // ✅ Connect to MongoDB (sahi function)
  await db.connect();

  // Start cron jobs
  startAllJobs(bot);
  logger.info('Cron jobs started');
});

// Export for Vercel
module.exports = app;

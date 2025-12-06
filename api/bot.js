// api/bot.js

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const db = require('../src/database/mongodb');       // ✅ correct path
const { setupBot } = require('../src/bot/setup');    // ✅ correct path
const logger = require('../src/utils/logger');       // ✅ correct path
const { startAllJobs } = require('../src/utils/cronJobs'); // ✅ correct path

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Telegram Bot (webhook mode)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Telegram AI Moderation Bot',
    version: '1.0.0'
  });
});

// Webhook endpoint (Vercel pe ye URL hoga: https://<project>/api/bot/webhook)
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    await bot.processUpdate(update);
    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Error processing update');
  }
});

// Setup bot handlers (commands, listeners, etc.)
setupBot(bot);

// Webhook set karne wala function
async function setWebhook() {
  try {
    // Example:
    // TELEGRAM_WEBHOOK_URL = https://telegram-ai-yuki-xxxxx.vercel.app/api/bot
    const baseUrl = process.env.TELEGRAM_WEBHOOK_URL;
    const webhookUrl = `${baseUrl}/webhook`;

    await bot.setWebHook(webhookUrl);
    logger.info(`Webhook set to: ${webhookUrl}`);

    // Commands set karna
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

// Init function: DB connect + webhook + cron jobs
async function init() {
  try {
    await db.connectToDatabase();
    logger.info('MongoDB connected');

    await setWebhook();

    startAllJobs(bot);
    logger.info('Cron jobs started');
  } catch (error) {
    logger.error('Error during bot initialization:', error);
  }
}

// Vercel pe: module load hote hi init chalega (cold start par)
init();

// Local development ke liye: sirf jab seedha `node api/bot.js` run karo
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

// Vercel ke liye Express app export
module.exports = app;

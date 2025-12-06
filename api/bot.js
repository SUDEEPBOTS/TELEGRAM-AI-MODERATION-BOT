// /api/bot.js

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Local modules
const db = require('../src/database/mongodb');          // << MongoDB helper instance
const { setupBot } = require('../src/bot/setup');
const logger = require('../src/utils/logger');
const { startAllJobs } = require('../src/utils/cronJobs');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Init Telegram bot (no polling, webhook only)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false,
});

// Health check
app.get('/', async (req, res) => {
  let dbStatus = {};
  try {
    dbStatus = db.getStatus();
  } catch {
    dbStatus = { connected: false };
  }

  res.json({
    status: 'online',
    service: 'Telegram AI ',
    version: '1.0.0',
    db: dbStatus,
  });
});

// Webhook endpoint (Telegram yaha POST karega)
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

// Bot handlers
setupBot(bot);

// ---- Initialization (DB + webhook + cron) ----
let initialized = false;

async function init() {
  if (initialized) return;
  initialized = true;

  // 1) MongoDB connect
  await db.connect();

  // 2) Webhook set
  const baseUrl = process.env.TELEGRAM_WEBHOOK_URL; 
  // e.g. "https://telegram-ai-moderation-bot.vercel.app/api/bot"
  const webhookUrl = `${baseUrl}/webhook`;

  await bot.setWebHook(webhookUrl);
  logger.info(`Webhook set to: ${webhookUrl}`);

  // 3) Commands
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

  // 4) Cron jobs
  startAllJobs(bot);
  logger.info('Cron jobs started');
}

// Vercel me request aate hi yeh function ek baar run hoga
init().catch((err) => {
  logger.error('Bot init failed:', err);
});

// IMPORTANT: Vercel ke liye sirf app export karo, app.listen mat use karo
module.exports = app;

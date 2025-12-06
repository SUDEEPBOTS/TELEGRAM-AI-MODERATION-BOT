// /api/bot.js

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// Local modules
const db = require('../src/database/mongodb');        // ⬅️ yaha ab class instance aa raha hai
const { setupBot } = require('../src/bot/setup');
const logger = require('../src/utils/logger');
const { startAllJobs } = require('../src/utils/cronJobs');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Telegram Bot (webhook mode, polling off)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false
});

// Setup bot handlers
setupBot(bot);

// --- Init helper (DB + cron jobs) ---
let jobsStarted = false;

async function ensureInit() {
  // MongoDB connect (agar already connected hoga to tumhari MongoDB class reuse karegi)
  await db.connect();

  // Cron jobs sirf ek baar start karo
  if (!jobsStarted) {
    startAllJobs(bot);
    jobsStarted = true;
    logger.info('Cron jobs started');
  }
}

// --- Health check ---
// URL: GET https://telegram-ai-moderation-bot.vercel.app/api/bot
app.get('/', async (req, res) => {
  try {
    await ensureInit();
    res.json({
      status: 'online',
      service: 'Telegram AI Moderation Bot',
      version: '1.0.0'
    });
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({ status: 'error', error: 'Health check failed' });
  }
});

// --- Telegram webhook endpoint ---
// IMPORTANT: ye POST '/' hai, toh external URL hoga: /api/bot
// URL: POST https://telegram-ai-moderation-bot.vercel.app/api/bot
app.post('/', async (req, res) => {
  try {
    await ensureInit();

    const update = req.body;
    await bot.processUpdate(update);

    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(500).send('Error processing update');
  }
});

// ❌ Vercel par app.listen() nahi use karna
// Vercel khud is app ko handler ki tarah use karega

// Export for Vercel
module.exports = app;

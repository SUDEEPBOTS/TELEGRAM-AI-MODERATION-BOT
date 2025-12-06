// api/bot.js
require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { setupBot } = require('../src/bot/setup');
const logger = require('../src/utils/logger');
// const mongoose = require('../src/database/mongodb');
// const cronJobs = require('../src/utils/cronJobs');

const app = express();

// Vercel apne aap port handle karta hai – yaha app.listen mat use karo
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Simple bot instance – NO polling, NO internal webhook server
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: false
});

// Bot handlers attach karo
setupBot(bot);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'Telegram AI Moderation Bot',
    version: '1.0.0'
  });
});

// ✅ Debug route (optional)
app.get('/webhook', (req, res) => {
  res.status(200).send('Webhook endpoint is alive (GET)');
});

// ✅ Webhook route – Telegram yaha POST karega
app.post('/webhook', async (req, res) => {
  try {
    logger.info('Incoming update from Telegram', {
      body: req.body,
      headers: req.headers
    });

    const update = req.body;
    await bot.processUpdate(update);

    // Bahut important: hamesha 200 bhejo
    res.sendStatus(200);
  } catch (error) {
    logger.error('Webhook error:', error);
    // Even on error, Telegram ko 200 de sakte ho, taki "wrong response" error na aaye
    res.sendStatus(200);
  }
});

// ❌ IMPORTANT: yaha app.listen() BILKUL NAHI hoga Vercel pe
// app.listen(PORT, ... ) hata do

// ❌ Ye bhi abhi mat karo: bot.setWebHook() yaha se
// Webhook hum manually Telegram API se set karenge curl se

// ✅ Vercel ke liye export
module.exports = app;

require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Telegram Bot
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('❌ ERROR: TELEGRAM_BOT_TOKEN is not set in environment variables');
  console.error('Please add TELEGRAM_BOT_TOKEN to your .env file');
}

const bot = new TelegramBot(BOT_TOKEN || 'dummy-token', {
  polling: false,
  webHook: false,
  onlyFirstMatch: true
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Yuki AI Moderation Bot 🤖',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      setwebhook: '/setwebhook',
      webhook: '/webhook (POST)',
      test: '/test'
    },
    environment: process.env.NODE_ENV || 'development',
    bot_configured: !!BOT_TOKEN
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    healthy: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    bot_token_set: !!BOT_TOKEN,
    node_version: process.version
  });
});

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: '✅ Bot server is working!',
    next_step: 'Set webhook at /setwebhook',
    webhook_info: 'Use: https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=<YOUR_URL>/webhook'
  });
});

// Manual webhook setting endpoint
app.get('/setwebhook', async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      return res.status(400).json({ 
        error: 'TELEGRAM_BOT_TOKEN not set',
        instructions: 'Add TELEGRAM_BOT_TOKEN to your .env file'
      });
    }
    
    // Get webhook URL
    const vercelUrl = process.env.VERCEL_URL || req.headers['x-vercel-deployment-url'] || 'your-app.vercel.app';
    const webhookUrl = `https://${vercelUrl}/webhook`;
    
    // Set webhook
    const result = await bot.setWebHook(webhookUrl);
    
    // Get webhook info
    const webhookInfo = await bot.getWebHookInfo();
    
    res.json({
      success: true,
      message: 'Webhook set successfully',
      webhook_url: webhookUrl,
      result: result,
      webhook_info: webhookInfo,
      bot_username: (await bot.getMe()).username,
      instructions: [
        '1. Webhook has been set',
        '2. Go to Telegram and message your bot',
        '3. Send /start to test',
        '4. Send /help for commands'
      ]
    });
    
  } catch (error) {
    res.status(500).json({
      error: 'Failed to set webhook',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      help: 'Check if TELEGRAM_BOT_TOKEN is correct'
    });
  }
});

// Webhook endpoint (Telegram will send updates here)
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;
    
    // Log the update (for debugging)
    if (process.env.NODE_ENV === 'development') {
      console.log('📨 Webhook received:', JSON.stringify(update, null, 2));
    }
    
    // Process message
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text || '';
      const from = update.message.from;
      const messageId = update.message.message_id;
      
      console.log(`💬 Message from ${from.first_name} (${from.id}): ${text}`);
      
      // Handle commands
      if (text.startsWith('/start')) {
        const welcomeMessage = `👋 *Welcome ${from.first_name}!*\n\n` +
          `I'm *Yuki*, your AI-powered moderation bot. 🤖\n\n` +
          `*Available Commands:*\n` +
          `/start - Start the bot\n` +
          `/help - Show help message\n` +
          `/ping - Check bot status\n` +
          `/id - Get ID information\n` +
          `/report - Report a message\n\n` +
          `*Admin Commands:*\n` +
          `/ban - Ban a user\n` +
          `/mute - Mute a user\n` +
          `/warn - Warn a user\n` +
          `/settings - Bot settings\n\n` +
          `Add me to your group and make me admin for full features!`;
        
        await bot.sendMessage(chatId, welcomeMessage, {
          parse_mode: 'Markdown',
          reply_to_message_id: messageId
        });
      }
      
      else if (text.startsWith('/help')) {
        const helpMessage = `🤖 *Yuki AI Bot Help*\n\n` +
          `*Basic Commands:*\n` +
          `/start - Welcome message\n` +
          `/ping - Check if bot is alive\n` +
          `/id - Get chat/user ID\n` +
          `/help - This message\n\n` +
          `*Moderation Commands (Admin only):*\n` +
          `/ban @username - Ban user\n` +
          `/mute @username 1h - Mute for 1 hour\n` +
          `/warn @username - Warn user\n` +
          `/kick @username - Kick user\n` +
          `/unban @username - Unban user\n` +
          `/unmute @username - Unmute user\n\n` +
          `*Features:*\n` +
          `• AI-powered moderation\n` +
          `• Auto-detection of spam/abuse\n` +
          `• Warning system\n` +
          `• Appeal system\n` +
          `• 24/7 monitoring`;
        
        await bot.sendMessage(chatId, helpMessage, {
          parse_mode: 'Markdown',
          reply_to_message_id: messageId
        });
      }
      
      else if (text.startsWith('/ping')) {
        const startTime = Date.now();
        const pingMessage = await bot.sendMessage(chatId, '🏓 Pinging...', {
          reply_to_message_id: messageId
        });
        const endTime = Date.now();
        
        await bot.editMessageText(
          `🏓 *Pong!*\n` +
          `• Latency: *${endTime - startTime}ms*\n` +
          `• Bot Uptime: *${Math.floor(process.uptime())}s*\n` +
          `• Status: *✅ Online*`,
          {
            chat_id: chatId,
            message_id: pingMessage.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
      
      else if (text.startsWith('/id')) {
        const idInfo = `🆔 *ID Information*\n\n` +
          `*Chat Info:*\n` +
          `• Title: ${update.message.chat.title || 'Private Chat'}\n` +
          `• Type: ${update.message.chat.type}\n` +
          `• Chat ID: \`${chatId}\`\n\n` +
          `*Your Info:*\n` +
          `• Name: ${from.first_name} ${from.last_name || ''}\n` +
          `• User ID: \`${from.id}\`\n` +
          `• Username: @${from.username || 'Not set'}\n\n` +
          `*Message Info:*\n` +
          `• Message ID: \`${messageId}\``;
        
        await bot.sendMessage(chatId, idInfo, {
          parse_mode: 'Markdown',
          reply_to_message_id: messageId
        });
      }
      
      else if (text.startsWith('/report') && update.message.reply_to_message) {
        const reportedMessage = update.message.reply_to_message;
        const reportedUser = reportedMessage.from;
        
        const reportMessage = `🚨 *Report Submitted*\n\n` +
          `Reported User: ${reportedUser.first_name}\n` +
          `User ID: \`${reportedUser.id}\`\n` +
          `Reason: ${text.replace('/report', '').trim() || 'Not specified'}\n\n` +
          `Thank you for helping keep the community safe!`;
        
        await bot.sendMessage(chatId, reportMessage, {
          parse_mode: 'Markdown',
          reply_to_message_id: messageId
        });
      }
      
      else if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
        await bot.sendMessage(chatId, `Hello ${from.first_name}! 👋 How can I help you?`, {
          reply_to_message_id: messageId
        });
      }
      
      else if (text.startsWith('/ban') || text.startsWith('/mute') || text.startsWith('/warn')) {
        // Check if user is admin (simplified check)
        const chatMember = await bot.getChatMember(chatId, from.id);
        const isAdmin = ['creator', 'administrator'].includes(chatMember.status);
        
        if (!isAdmin) {
          await bot.sendMessage(chatId, 
            `❌ *Permission Denied*\n\n` +
            `You need to be an admin to use this command.`,
            { parse_mode: 'Markdown', reply_to_message_id: messageId }
          );
          return;
        }
        
        // Handle admin commands
        if (text.startsWith('/ban')) {
          await bot.sendMessage(chatId, 
            `🚫 *Ban Command*\n\n` +
            `Usage: \`/ban @username [reason]\`\n` +
            `or reply to a message with \`/ban [reason]\``,
            { parse_mode: 'Markdown', reply_to_message_id: messageId }
          );
        }
        else if (text.startsWith('/mute')) {
          await bot.sendMessage(chatId, 
            `🔇 *Mute Command*\n\n` +
            `Usage: \`/mute @username 1h [reason]\`\n` +
            `Time formats: 30m, 1h, 6h, 1d, 7d`,
            { parse_mode: 'Markdown', reply_to_message_id: messageId }
          );
        }
        else if (text.startsWith('/warn')) {
          await bot.sendMessage(chatId, 
            `⚠️ *Warn Command*\n\n` +
            `Usage: \`/warn @username [reason]\`\n` +
            `or reply to a message with \`/warn [reason]\``,
            { parse_mode: 'Markdown', reply_to_message_id: messageId }
          );
        }
      }
      
      else if (text.startsWith('/settings')) {
        const settingsMessage = `⚙️ *Bot Settings*\n\n` +
          `*Current Configuration:*\n` +
          `• AI Moderation: ✅ Enabled\n` +
          `• Auto-Delete Links: ✅ Enabled\n` +
          `• Welcome Messages: ✅ Enabled\n` +
          `• Logging: ✅ Enabled\n\n` +
          `*Quick Actions:*\n` +
          `Use /settings in a group to configure.`;
        
        await bot.sendMessage(chatId, settingsMessage, {
          parse_mode: 'Markdown',
          reply_to_message_id: messageId
        });
      }
      
      else if (text.startsWith('@')) {
        // Check if bot is mentioned
        const botUser = await bot.getMe();
        if (text.includes(`@${botUser.username}`)) {
          const response = text.replace(`@${botUser.username}`, '').trim();
          if (response) {
            await bot.sendMessage(chatId, 
              `You mentioned me! You said: "${response}"\n\n` +
              `Try /help to see what I can do!`,
              { reply_to_message_id: messageId }
            );
          }
        }
      }
    }
    
    // Always respond with 200 OK to Telegram
    res.sendStatus(200);
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    // Send error to bot owner if configured
    const ownerId = process.env.TELEGRAM_OWNER_ID;
    if (ownerId && BOT_TOKEN) {
      try {
        await bot.sendMessage(ownerId, 
          `🚨 *Bot Error*\n\n` +
          `Error: ${error.message}\n` +
          `Time: ${new Date().toISOString()}\n` +
          `Update: ${JSON.stringify(req.body).substring(0, 100)}...`,
          { parse_mode: 'Markdown' }
        );
      } catch (sendError) {
        console.error('Failed to send error to owner:', sendError);
      }
    }
    
    // Still respond with 200 to prevent Telegram from retrying
    res.sendStatus(200);
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    available_endpoints: ['/', '/health', '/setwebhook', '/test', '/webhook (POST)']
  });
});

// Set webhook on startup
async function initializeBot() {
  try {
    if (!BOT_TOKEN) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN not set. Bot features disabled.');
      return;
    }
    
    // Get bot info
    const botInfo = await bot.getMe();
    console.log(`🤖 Bot initialized: @${botInfo.username} (${botInfo.id})`);
    
    // Set webhook if in production
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL_URL) {
      const vercelUrl = process.env.VERCEL_URL || 'your-app.vercel.app';
      const webhookUrl = `https://${vercelUrl}/webhook`;
      
      await bot.setWebHook(webhookUrl);
      console.log(`✅ Webhook set to: ${webhookUrl}`);
      
      // Set bot commands
      await bot.setMyCommands([
        { command: 'start', description: 'Start the bot' },
        { command: 'help', description: 'Show help' },
        { command: 'ping', description: 'Check bot status' },
        { command: 'id', description: 'Get ID information' },
        { command: 'report', description: 'Report a message' },
        { command: 'settings', description: 'Bot settings' }
      ]);
      
      console.log('✅ Bot commands set successfully');
    }
    
  } catch (error) {
    console.error('❌ Bot initialization error:', error.message);
  }
}

// Initialize bot
initializeBot();

// Start server for local development
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📋 Endpoints:`);
    console.log(`   • http://localhost:${PORT}/`);
    console.log(`   • http://localhost:${PORT}/health`);
    console.log(`   • http://localhost:${PORT}/setwebhook`);
    console.log(`   • http://localhost:${PORT}/test`);
    console.log(`🤖 Set webhook: http://localhost:${PORT}/setwebhook`);
  });
}

// Export for Vercel
module.exports = app;

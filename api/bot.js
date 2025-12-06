require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();

// ✅ CRITICAL FIX: Middleware MUST be first
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ FIX: Define BOT_TOKEN here (not later)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8572357899:AAELjJlX7NuitZ3J_w3ZSTwt8WXR0oW3I5c';

console.log('🚀 Bot starting...');
console.log('Environment:', process.env.NODE_ENV || 'production');
console.log('Vercel URL:', process.env.VERCEL_URL);
console.log('Bot Token present:', !!BOT_TOKEN);

// ✅ FIX: Initialize bot AFTER middleware
const bot = new TelegramBot(BOT_TOKEN, {
  polling: false,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

// ✅ FIX: Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'online', 
    service: 'Yuki AI Moderation Bot 🤖',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      setwebhook: '/setwebhook',
      test: '/test',
      webhook: '/webhook (POST)'
    },
    environment: process.env.NODE_ENV || 'production',
    bot_configured: !!BOT_TOKEN
  });
});

// ✅ FIX: Health endpoint
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

// ✅ FIX: Test endpoint
app.get('/test', (req, res) => {
  res.json({ 
    message: '✅ Bot server is working!',
    next_step: 'Set webhook at /setwebhook',
    webhook_info: `Use: https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=https://${process.env.VERCEL_URL || 'telegram-ai-yuki-llye3w5d0-sudeeps-projects-b2376a53.vercel.app'}/webhook`
  });
});

// ✅ FIX: Manual webhook setting endpoint
app.get('/setwebhook', async (req, res) => {
  try {
    if (!BOT_TOKEN) {
      return res.status(400).json({ 
        error: 'TELEGRAM_BOT_TOKEN not set',
        instructions: 'Add TELEGRAM_BOT_TOKEN to your .env file'
      });
    }
    
    // Get webhook URL
    const vercelUrl = process.env.VERCEL_URL || 'telegram-ai-yuki-llye3w5d0-sudeeps-projects-b2376a53.vercel.app';
    const webhookUrl = `https://${vercelUrl}/webhook`;
    
    console.log(`🔗 Setting webhook to: ${webhookUrl}`);
    
    // Delete old webhook first
    try {
      await bot.deleteWebHook();
      console.log('🗑️ Old webhook deleted');
    } catch (deleteError) {
      console.log('No old webhook to delete');
    }
    
    // Set new webhook
    const setResult = await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook set result:', setResult);
    
    // Get webhook info
    const webhookInfo = await bot.getWebHookInfo();
    console.log('📋 Webhook info:', JSON.stringify(webhookInfo, null, 2));
    
    // Get bot info
    const botInfo = await bot.getMe();
    
    res.json({
      success: true,
      message: 'Webhook set successfully',
      webhook_url: webhookUrl,
      webhook_info: webhookInfo,
      bot_username: botInfo.username,
      instructions: [
        '1. Webhook has been set',
        '2. Go to Telegram and message your bot',
        '3. Send /start to test',
        '4. Send /help for commands'
      ]
    });
    
  } catch (error) {
    console.error('❌ setwebhook error:', error);
    res.status(500).json({
      error: 'Failed to set webhook',
      message: error.message,
      help: 'Check if TELEGRAM_BOT_TOKEN is correct'
    });
  }
});

// ✅ FIX: Webhook endpoint - SIMPLIFIED & FIXED
app.post('/webhook', async (req, res) => {
  console.log('📨 Webhook received at', new Date().toISOString());
  
  try {
    const update = req.body;
    
    // ✅ FIX: IMMEDIATELY respond with 200
    res.status(200).json({ ok: true, received: true });
    
    // Process asynchronously
    setTimeout(async () => {
      try {
        if (update.message) {
          const chatId = update.message.chat.id;
          const text = update.message.text || '';
          const from = update.message.from;
          const messageId = update.message.message_id;
          
          console.log(`💬 Message from ${from.first_name} (${from.id}): ${text}`);
          
          // ✅ FIX: Handle /start command
          if (text === '/start' || text === '/start@Ai_admin4bot') {
            const welcomeMessage = `🎉 *Yuki AI Bot is WORKING!*\n\n` +
              `Hello ${from.first_name}! I'm online and ready.\n\n` +
              `*Commands:*\n` +
              `/start - Welcome message\n` +
              `/ping - Test response\n` +
              `/id - Get ID information\n` +
              `/help - Show all commands\n\n` +
              `Add me to your group for AI moderation!`;
            
            await bot.sendMessage(chatId, welcomeMessage, {
              parse_mode: 'Markdown'
            });
            console.log('✅ Start message sent');
          }
          
          // ✅ FIX: Handle /ping command
          else if (text === '/ping' || text === '/ping@Ai_admin4bot') {
            const startTime = Date.now();
            const pingMsg = await bot.sendMessage(chatId, '🏓 Pinging...');
            const endTime = Date.now();
            
            await bot.editMessageText(
              `🏓 *Pong!*\n` +
              `• Latency: *${endTime - startTime}ms*\n` +
              `• Bot Uptime: *${Math.floor(process.uptime())}s*`,
              {
                chat_id: chatId,
                message_id: pingMsg.message_id,
                parse_mode: 'Markdown'
              }
            );
            console.log('✅ Ping response sent');
          }
          
          // ✅ FIX: Handle /id command
          else if (text === '/id' || text === '/id@Ai_admin4bot') {
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
              parse_mode: 'Markdown'
            });
            console.log('✅ ID info sent');
          }
          
          // ✅ FIX: Handle /help command
          else if (text === '/help' || text === '/help@Ai_admin4bot') {
            const helpMessage = `🤖 *Yuki AI Bot Help*\n\n` +
              `*Basic Commands:*\n` +
              `/start - Welcome message\n` +
              `/ping - Test bot response\n` +
              `/id - Get ID information\n` +
              `/help - This message\n\n` +
              `*Moderation Commands (in groups):*\n` +
              `/ban - Ban a user\n` +
              `/mute - Mute a user\n` +
              `/warn - Warn a user\n` +
              `/kick - Kick a user\n\n` +
              `*Features:*\n` +
              `• AI-powered moderation\n` +
              `• 24/7 monitoring\n` +
              `• Welcome messages\n` +
              `• Report system`;
            
            await bot.sendMessage(chatId, helpMessage, {
              parse_mode: 'Markdown'
            });
            console.log('✅ Help message sent');
          }
          
          // ✅ FIX: Handle hello/hi
          else if (text.toLowerCase().includes('hello') || text.toLowerCase().includes('hi')) {
            await bot.sendMessage(chatId, 
              `👋 Hello ${from.first_name}! How can I help you?\n\n` +
              `Send /help for commands.`,
              { parse_mode: 'Markdown' }
            );
          }
          
          // ✅ FIX: Handle any other message
          else if (text) {
            await bot.sendMessage(chatId, 
              `🤖 Hi ${from.first_name}! I'm Yuki AI Bot.\n\n` +
              `Send /start to begin or /help for commands.`,
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch (processError) {
        console.error('❌ Message processing error:', processError);
      }
    }, 0);
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Still return 200
    res.status(200).json({ ok: false, error: error.message });
  }
});

// ✅ FIX: Initialize bot on startup
async function initializeBot() {
  try {
    if (!BOT_TOKEN) {
      console.warn('⚠️ TELEGRAM_BOT_TOKEN not set. Bot features disabled.');
      return;
    }
    
    // Get bot info
    const botInfo = await bot.getMe();
    console.log(`🤖 Bot initialized: @${botInfo.username} (${botInfo.id})`);
    
    // Set webhook
    const vercelUrl = process.env.VERCEL_URL || 'telegram-ai-yuki-llye3w5d0-sudeeps-projects-b2376a53.vercel.app';
    const webhookUrl = `https://${vercelUrl}/webhook`;
    
    console.log(`🔗 Setting webhook to: ${webhookUrl}`);
    
    try {
      await bot.deleteWebHook();
      console.log('🗑️ Old webhook deleted');
    } catch (deleteError) {
      console.log('No old webhook to delete');
    }
    
    const setResult = await bot.setWebHook(webhookUrl);
    console.log('✅ Webhook set result:', setResult);
    
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
    
    // Verify webhook
    const webhookInfo = await bot.getWebHookInfo();
    console.log('📋 Webhook info:', JSON.stringify(webhookInfo, null, 2));
    
  } catch (error) {
    console.error('❌ Bot initialization error:', error.message);
  }
}

// ✅ FIX: Initialize bot
initializeBot();

// ✅ FIX: Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ✅ FIX: 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    available_endpoints: ['/', '/health', '/setwebhook', '/test', '/webhook (POST)']
  });
});

// ✅ FIX: Export for Vercel
module.exports = app;

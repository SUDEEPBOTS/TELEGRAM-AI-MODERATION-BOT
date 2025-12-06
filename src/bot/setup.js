const messageHandler = require('../handlers/messageHandler');
const callbackHandler = require('../handlers/callbackHandler');
const adminHandler = require('../handlers/adminHandler');
const moderationHandler = require('../handlers/moderationHandler');
const logger = require('../utils/logger');

function setupBot(bot) {
  
  // Message handler
  bot.on('message', async (msg) => {
    try {
      await messageHandler.handleMessage(bot, msg);
    } catch (error) {
      logger.error('Message handler error:', error);
    }
  });
  
  // Callback queries (inline buttons)
  bot.on('callback_query', async (callbackQuery) => {
    try {
      await callbackHandler.handleCallback(bot, callbackQuery);
    } catch (error) {
      logger.error('Callback handler error:', error);
    }
  });
  
  // New chat members
  bot.on('new_chat_members', async (msg) => {
    try {
      await moderationHandler.handleNewMembers(bot, msg);
    } catch (error) {
      logger.error('New members handler error:', error);
    }
  });
  
  // Left chat member
  bot.on('left_chat_member', async (msg) => {
    try {
      await moderationHandler.handleLeftMember(bot, msg);
    } catch (error) {
      logger.error('Left member handler error:', error);
    }
  });
  
  // Chat member updates
  bot.on('chat_member', async (chatMember) => {
    try {
      await moderationHandler.handleChatMemberUpdate(bot, chatMember);
    } catch (error) {
      logger.error('Chat member update error:', error);
    }
  });
  
  // Error handling
  bot.on('polling_error', (error) => {
    logger.error('Polling error:', error);
  });
  
  bot.on('webhook_error', (error) => {
    logger.error('Webhook error:', error);
  });
  
  logger.info('Bot handlers setup completed');
}

module.exports = { setupBot };

const User = require('../database/models/User');
const Group = require('../database/models/Group');
const Log = require('../database/models/Log');
const geminiService = require('./geminiService');
const logger = require('../utils/logger');
const Helpers = require('../utils/helpers');

class ModerationService {
  constructor() {
    this.cooldowns = new Map();
    this.rateLimits = new Map();
    this.badWords = [
      'gadha', 'gadhe', 'gadhi', 'kutta', 'kutte', 'kutti', 
      'sale', 'saale', 'madarchod', 'bhosdike', 'chutiya',
      'bewakoof', 'nalayak', 'harami', 'kamina', 'lund',
      'randi', 'rand', 'gandu', 'bhenchod', 'behenchod'
    ];
    
    this.spamPatterns = [
      /(.)\1{5,}/, // Repeated characters
      /(http|https|www\.|\.[a-z]{2,})/i, // URLs
      /[\u2700-\u27BF]|[\uE000-\uF8FF]|�[�-�]|�[�-�]|[️-️]|[\u2011-\u26FF]|�[�-�]/gu, // Excessive emojis
      /[\u2580-\u259F]|[\u25A0-\u25FF]/gu // Block characters
    ];
  }

  /**
   * Analyze message and take appropriate action
   */
  async analyzeAndAct(bot, msg, group, user) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const text = msg.text || '';
    const entities = msg.entities || [];

    // Check if user is ignored
    if (group.isIgnored(userId)) {
      return;
    }

    // Check cooldown
    if (this.isOnCooldown(chatId, userId)) {
      return;
    }

    // Fast checks before AI analysis
    const fastCheck = await this.fastContentCheck(text, entities);
    if (fastCheck.action !== 'PASS') {
      await this.executeFastAction(bot, msg, fastCheck);
      return;
    }

    // Check for spam patterns
    if (this.isSpam(text)) {
      await this.handleSpam(bot, msg, group, user);
      return;
    }

    // Check for bad words
    const badWordCheck = this.checkBadWords(text);
    if (badWordCheck.found) {
      await this.handleBadWords(bot, msg, group, user, badWordCheck);
      return;
    }

    // Check flood/rate limiting
    if (this.isFlooding(chatId, userId)) {
      await this.handleFlood(bot, msg, group, user);
      return;
    }

    // AI Moderation (if enabled)
    if (group.settings.aiModeration && text.trim().length > 3) {
      await this.aiModeration(bot, msg, group, user);
    }

    // Update cooldown
    this.updateCooldown(chatId, userId);
  }

  /**
   * Fast content check for common violations
   */
  async fastContentCheck(text, entities) {
    // Check for empty or very short messages
    if (!text || text.trim().length < 2) {
      return { action: 'IGNORE' };
    }

    // Check for excessive length
    if (text.length > 4000) {
      return { 
        action: 'DELETE', 
        reason: 'Message too long (exceeds 4000 characters)' 
      };
    }

    // Check for excessive caps
    const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (capsRatio > 0.7 && text.length > 10) {
      return { 
        action: 'WARN', 
        reason: 'Excessive use of capital letters' 
      };
    }

    // Check for links if not allowed
    const hasLink = entities.some(e => e.type === 'url') || 
                   /https?:\/\//i.test(text) ||
                   /www\./i.test(text);
    
    if (hasLink) {
      return { 
        action: 'CHECK', 
        reason: 'Contains link' 
      };
    }

    // Check for phone numbers
    const phoneRegex = /(\+?(\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/g;
    if (phoneRegex.test(text)) {
      return { 
        action: 'DELETE', 
        reason: 'Contains phone number' 
      };
    }

    // Check for email addresses
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    if (emailRegex.test(text)) {
      return { 
        action: 'DELETE', 
        reason: 'Contains email address' 
      };
    }

    return { action: 'PASS' };
  }

  /**
   * Execute fast action without AI
   */
  async executeFastAction(bot, msg, check) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;

    switch (check.action) {
      case 'DELETE':
        await this.deleteMessage(bot, chatId, messageId);
        await this.sendWarning(bot, chatId, userId, check.reason);
        break;

      case 'WARN':
        await this.warnUser(bot, chatId, userId, check.reason);
        break;

      case 'CHECK':
        // Let AI handle links
        break;

      default:
        // IGNORE - do nothing
        break;
    }
  }

  /**
   * AI-powered moderation
   */
  async aiModeration(bot, msg, group, user) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const text = msg.text || '';

    try {
      // Prepare context for AI
      const context = {
        senderName: `${msg.from.first_name} ${msg.from.last_name || ''}`,
        senderUsername: msg.from.username || 'no_username',
        groupName: msg.chat.title,
        warnings: user.getGroupWarnings(chatId).length,
        isAdmin: group.isAdmin(userId),
        groupRules: group.rules.text,
        messageLength: text.length,
        hasMedia: !!msg.photo || !!msg.video || !!msg.document || !!msg.audio
      };

      // Get AI decision
      const decision = await geminiService.moderateMessage(text, context);
      
      // Log AI decision
      await Log.log({
        type: 'AI_MODERATION',
        groupId: chatId,
        userId: userId,
        action: 'ai_analysis',
        details: {
          decision: decision,
          message: text.substring(0, 100),
          confidence: decision.severity
        }
      });

      // Execute AI decision
      if (decision.action !== 'IGNORE') {
        await this.executeAIDecision(bot, chatId, userId, messageId, decision, group, user);
      }

    } catch (error) {
      logger.error('AI moderation error:', error);
      
      // Fallback to basic moderation
      await this.basicModeration(bot, msg, group, user);
    }
  }

  /**
   * Execute AI decision
   */
  async executeAIDecision(bot, chatId, userId, messageId, decision, group, user) {
    try {
      const userMention = `<a href="tg://user?id=${userId}">${user.firstName}</a>`;
      const admin = await bot.getMe();
      
      // Always delete message if AI suggests
      if (decision.action === 'DELETE' || decision.delete_message) {
        await this.deleteMessage(bot, chatId, messageId);
      }

      switch (decision.action) {
        case 'WARN':
          await this.warnUser(bot, chatId, userId, decision.reason);
          await this.sendPublicMessage(bot, chatId, decision.response || 
            `⚠️ ${userMention}, warning: ${decision.reason}`);
          break;

        case 'MUTE':
          const muteDuration = decision.duration || group.settings.muteDuration;
          await this.muteUser(bot, chatId, userId, muteDuration, decision.reason);
          
          // Add to user history
          await user.addMute(chatId, decision.reason, admin.id, muteDuration);
          
          // Update group stats
          await this.updateGroupStats(group, 'mutes');
          
          // Send public message
          await this.sendPublicMessage(bot, chatId,
            `🔇 ${userMention} has been muted for ${Helpers.formatDuration(muteDuration)}\n` +
            `Reason: ${decision.reason}`,
            this.getAppealKeyboard(userId, chatId, 'MUTE')
          );
          break;

        case 'KICK':
          await this.kickUser(bot, chatId, userId, decision.reason);
          
          // Send public message
          await this.sendPublicMessage(bot, chatId,
            `👢 ${userMention} has been kicked\n` +
            `Reason: ${decision.reason}`
          );
          break;

        case 'BAN':
          const banDuration = decision.duration || group.settings.banDuration;
          await this.banUser(bot, chatId, userId, banDuration, decision.reason);
          
          // Add to user history
          await user.addBan(chatId, decision.reason, admin.id, banDuration);
          
          // Update group stats
          await this.updateGroupStats(group, 'bans');
          
          // Send public message
          const durationText = banDuration > 0 ? 
            `for ${Helpers.formatDuration(banDuration)}` : 'permanently';
          
          await this.sendPublicMessage(bot, chatId,
            `🚫 ${userMention} has been banned ${durationText}\n` +
            `Reason: ${decision.reason}`,
            this.getAppealKeyboard(userId, chatId, 'BAN')
          );
          break;

        case 'DELETE':
          // Already deleted above
          if (decision.response) {
            await this.sendPublicMessage(bot, chatId, decision.response);
          }
          break;
      }

      // Send DM to user
      if (decision.dm_message) {
        await this.sendActionDM(bot, userId, decision.action, {
          reason: decision.reason,
          duration: decision.duration,
          group: group.title
        });
      }

      // Log the action
      await Log.log({
        type: 'MOD_ACTION',
        groupId: chatId,
        userId: userId,
        targetUserId: userId,
        action: `ai_${decision.action.toLowerCase()}`,
        details: {
          reason: decision.reason,
          severity: decision.severity,
          duration: decision.duration,
          ai_response: decision.response
        }
      });

    } catch (error) {
      logger.error(`Error executing AI decision ${decision.action}:`, error);
      
      // Log error
      await Log.log({
        type: 'ERROR',
        groupId: chatId,
        action: 'ai_action_failed',
        details: {
          action: decision.action,
          error: error.message,
          userId: userId
        }
      });
    }
  }

  /**
   * Basic moderation (fallback when AI fails)
   */
  async basicModeration(bot, msg, group, user) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || '';

    // Check message length
    if (text.length > 1000) {
      await this.deleteMessage(bot, chatId, msg.message_id);
      await this.warnUser(bot, chatId, userId, 'Message too long');
      return;
    }

    // Check for excessive newlines
    const newlineCount = (text.match(/\n/g) || []).length;
    if (newlineCount > 10) {
      await this.deleteMessage(bot, chatId, msg.message_id);
      await this.warnUser(bot, chatId, userId, 'Excessive line breaks');
      return;
    }

    // Check for repeated messages
    if (await this.isRepeatedMessage(chatId, userId, text)) {
      await this.deleteMessage(bot, chatId, msg.message_id);
      await this.warnUser(bot, chatId, userId, 'Repeated messages');
      return;
    }
  }

  /**
   * Check for bad words
   */
  checkBadWords(text) {
    const lowerText = text.toLowerCase();
    const foundWords = [];
    
    for (const word of this.badWords) {
      if (lowerText.includes(word)) {
        foundWords.push(word);
      }
    }

    if (foundWords.length > 0) {
      return {
        found: true,
        words: foundWords,
        severity: foundWords.length > 2 ? 'HIGH' : 'MEDIUM'
      };
    }

    return { found: false, words: [], severity: 'LOW' };
  }

  /**
   * Handle bad words
   */
  async handleBadWords(bot, msg, group, user, check) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;

    // Delete message
    await this.deleteMessage(bot, chatId, messageId);

    // Take action based on severity
    switch (check.severity) {
      case 'HIGH':
        await this.muteUser(bot, chatId, userId, 86400, // 24 hours
          `Using prohibited words: ${check.words.join(', ')}`);
        break;

      case 'MEDIUM':
        await this.warnUser(bot, chatId, userId, 
          `Using inappropriate language: ${check.words.join(', ')}`);
        break;

      default:
        // Just delete
        break;
    }

    // Send public warning
    await bot.sendMessage(chatId,
      `⚠️ Please maintain respectful language. ${check.words.length} inappropriate word(s) detected.`,
      { reply_to_message_id: messageId }
    );
  }

  /**
   * Check for spam patterns
   */
  isSpam(text) {
    // Check for repeated characters
    if (/(.)\1{8,}/.test(text)) {
      return true;
    }

    // Check for excessive special characters
    const specialCharRatio = (text.match(/[^a-zA-Z0-9\s]/g) || []).length / text.length;
    if (specialCharRatio > 0.5 && text.length > 20) {
      return true;
    }

    // Check for common spam phrases
    const spamPhrases = [
      'join now', 'free money', 'earn fast', 'click here',
      'limited offer', 'special deal', 'make money',
      'work from home', 'investment', 'lottery', 'prize'
    ];

    const lowerText = text.toLowerCase();
    return spamPhrases.some(phrase => lowerText.includes(phrase));
  }

  /**
   * Handle spam
   */
  async handleSpam(bot, msg, group, user) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;

    // Delete spam message
    await this.deleteMessage(bot, chatId, messageId);

    // Check spam count
    const spamCount = this.getUserSpamCount(chatId, userId);
    
    if (spamCount >= 3) {
      // Ban after 3 spam messages
      await this.banUser(bot, chatId, userId, 0, 'Excessive spam');
      await bot.sendMessage(chatId,
        `🚫 User banned for excessive spamming.`
      );
    } else if (spamCount >= 2) {
      // Mute after 2 spam messages
      await this.muteUser(bot, chatId, userId, 7200, 'Repeated spam'); // 2 hours
      await bot.sendMessage(chatId,
        `🔇 User muted for 2 hours for spamming.`
      );
    } else {
      // Warn for first spam
      await this.warnUser(bot, chatId, userId, 'Spam detected');
      await bot.sendMessage(chatId,
        `⚠️ Please don't spam.`,
        { reply_to_message_id: messageId }
      );
    }

    // Update spam count
    this.updateUserSpamCount(chatId, userId);
  }

  /**
   * Check for flooding
   */
  isFlooding(chatId, userId) {
    const key = `${chatId}:${userId}`;
    const now = Date.now();
    
    if (!this.rateLimits.has(key)) {
      this.rateLimits.set(key, {
        count: 1,
        firstMessage: now,
        lastMessage: now
      });
      return false;
    }

    const userLimit = this.rateLimits.get(key);
    const timeDiff = now - userLimit.firstMessage;

    // Reset if more than 10 seconds passed
    if (timeDiff > 10000) {
      this.rateLimits.set(key, {
        count: 1,
        firstMessage: now,
        lastMessage: now
      });
      return false;
    }

    // Check message count
    userLimit.count++;
    userLimit.lastMessage = now;

    // More than 5 messages in 10 seconds = flooding
    if (userLimit.count > 5) {
      return true;
    }

    return false;
  }

  /**
   * Handle flooding
   */
  async handleFlood(bot, msg, group, user) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Delete recent messages
    const recentMessages = await this.getRecentUserMessages(chatId, userId);
    for (const msgId of recentMessages) {
      try {
        await bot.deleteMessage(chatId, msgId);
      } catch (error) {
        // Ignore deletion errors
      }
    }

    // Mute user for flooding
    await this.muteUser(bot, chatId, userId, 3600, 'Message flooding'); // 1 hour
    
    await bot.sendMessage(chatId,
      `🔇 User muted for 1 hour for message flooding.`
    );

    // Clear rate limit for this user
    this.clearRateLimit(chatId, userId);
  }

  /**
   * Check for repeated messages
   */
  async isRepeatedMessage(chatId, userId, text) {
    // In production, you'd check against recent messages in database
    // This is a simplified version
    const key = `${chatId}:${userId}:last`;
    const lastMessage = this.messageCache.get(key);
    
    if (lastMessage && lastMessage.text === text) {
      const timeDiff = Date.now() - lastMessage.time;
      return timeDiff < 30000; // 30 seconds
    }
    
    this.messageCache.set(key, { text, time: Date.now() });
    return false;
  }

  /**
   * Delete message
   */
  async deleteMessage(bot, chatId, messageId) {
    try {
      await bot.deleteMessage(chatId, messageId);
      return true;
    } catch (error) {
      logger.error(`Failed to delete message ${messageId}:`, error.message);
      return false;
    }
  }

  /**
   * Warn user
   */
  async warnUser(bot, chatId, userId, reason) {
    try {
      const user = await User.findOne({ userId });
      if (!user) return;

      // Add warning
      const admin = await bot.getMe();
      await user.addWarning(chatId, reason, admin.id);

      // Get group
      const group = await Group.findOne({ groupId: chatId });
      if (!group) return;

      // Update group stats
      group.stats.totalWarnings += 1;
      await group.save();

      // Check max warnings
      const warnings = user.getGroupWarnings(chatId);
      if (warnings.length >= group.settings.maxWarnings) {
        // Auto-mute
        await this.muteUser(bot, chatId, userId, group.settings.muteDuration,
          `Reached maximum warnings (${warnings.length})`);
        
        // Clear warnings
        user.warnings = user.warnings.filter(w => w.groupId !== chatId);
        await user.save();

        await bot.sendMessage(chatId,
          `⚠️ User has received ${warnings.length} warnings and has been auto-muted.`
        );
      }

      // Send DM
      await this.sendActionDM(bot, userId, 'WARNED', {
        reason: reason,
        warnings: warnings.length,
        maxWarnings: group.settings.maxWarnings,
        group: group.title
      });

      return true;

    } catch (error) {
      logger.error(`Failed to warn user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Mute user
   */
  async muteUser(bot, chatId, userId, duration, reason) {
    try {
      await bot.restrictChatMember(chatId, userId, {
        until_date: Math.floor(Date.now() / 1000) + duration,
        can_send_messages: false,
        can_send_media_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
        can_send_polls: false
      });

      // Log action
      await Log.log({
        type: 'MOD_ACTION',
        groupId: chatId,
        userId: userId,
        action: 'mute',
        details: { duration, reason }
      });

      return true;

    } catch (error) {
      logger.error(`Failed to mute user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Ban user
   */
  async banUser(bot, chatId, userId, duration, reason) {
    try {
      await bot.banChatMember(chatId, userId, {
        until_date: duration > 0 ? Math.floor(Date.now() / 1000) + duration : undefined
      });

      // Log action
      await Log.log({
        type: 'MOD_ACTION',
        groupId: chatId,
        userId: userId,
        action: 'ban',
        details: { duration, reason }
      });

      return true;

    } catch (error) {
      logger.error(`Failed to ban user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Kick user
   */
  async kickUser(bot, chatId, userId, reason) {
    try {
      await bot.banChatMember(chatId, userId);
      
      // Unban immediately (kick)
      setTimeout(() => {
        bot.unbanChatMember(chatId, userId);
      }, 1000);

      // Log action
      await Log.log({
        type: 'MOD_ACTION',
        groupId: chatId,
        userId: userId,
        action: 'kick',
        details: { reason }
      });

      return true;

    } catch (error) {
      logger.error(`Failed to kick user ${userId}:`, error);
      return false;
    }
  }

  /**
      * Send action DM to user
   */
  async sendActionDM(bot, userId, action, data) {
    try {
      let message = '';
      let keyboard = null;

      switch (action) {
        case 'WARNED':
          message = `⚠️ <b>You have been warned</b>\n\n` +
            `Group: ${data.group}\n` +
            `Reason: ${data.reason}\n` +
            `Warnings: ${data.warnings}/${data.maxWarnings}\n\n` +
            `Further violations may result in a mute or ban.`;
          break;

        case 'MUTED':
          message = `🔇 <b>You have been muted</b>\n\n` +
            `Group: ${data.group}\n` +
            `Reason: ${data.reason}\n` +
            `Duration: ${Helpers.formatDuration(data.duration)}\n\n` +
            `You cannot send messages until the mute expires.`;
          
          keyboard = {
            inline_keyboard: [[{
              text: '📝 Appeal Mute',
              callback_data: `appeal_mute_${userId}_${data.groupId || 0}`
            }]]
          };
          break;

        case 'BANNED':
          message = `🚫 <b>You have been banned</b>\n\n` +
            `Group: ${data.group}\n` +
            `Reason: ${data.reason}\n` +
            `Duration: ${data.duration > 0 ? Helpers.formatDuration(data.duration) : 'Permanent'}\n\n` +
            `You can appeal this ban.`;
          
          keyboard = {
            inline_keyboard: [[{
              text: '📝 Appeal Ban',
              callback_data: `appeal_ban_${userId}_${data.groupId || 0}`
            }]]
          };
          break;

        case 'KICKED':
          message = `👢 <b>You have been kicked</b>\n\n` +
            `Group: ${data.group}\n` +
            `Reason: ${data.reason}\n\n` +
            `You can rejoin the group.`;
          break;
      }

      await bot.sendMessage(userId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

      return true;

    } catch (error) {
      // User might have blocked the bot
      logger.warn(`Could not send DM to user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * Send public message with optional keyboard
   */
  async sendPublicMessage(bot, chatId, text, keyboard = null) {
    try {
      const options = {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };

      if (keyboard) {
        options.reply_markup = keyboard;
      }

      await bot.sendMessage(chatId, text, options);
      return true;

    } catch (error) {
      logger.error(`Failed to send public message:`, error);
      return false;
    }
  }

  /**
   * Get appeal keyboard
   */
  getAppealKeyboard(userId, groupId, action) {
    return {
      inline_keyboard: [[{
        text: `📝 Appeal ${action}`,
        callback_data: `appeal_${action.toLowerCase()}_${userId}_${groupId}`
      }]]
    };
  }

  /**
   * Update group statistics
   */
  async updateGroupStats(group, statType) {
    switch (statType) {
      case 'warnings':
        group.stats.totalWarnings += 1;
        break;
      case 'mutes':
        group.stats.totalMutes += 1;
        break;
      case 'bans':
        group.stats.totalBans += 1;
        break;
    }

    group.stats.lastActivity = new Date();
    await group.save();
  }

  /**
   * Cooldown management
   */
  isOnCooldown(chatId, userId) {
    const key = `${chatId}:${userId}`;
    const cooldown = this.cooldowns.get(key);
    
    if (!cooldown) return false;
    
    const now = Date.now();
    if (now - cooldown < 5000) { // 5 second cooldown
      return true;
    }
    
    return false;
  }

  updateCooldown(chatId, userId) {
    const key = `${chatId}:${userId}`;
    this.cooldowns.set(key, Date.now());
    
    // Cleanup old cooldowns every minute
    if (Math.random() < 0.01) { // 1% chance on each call
      this.cleanupCooldowns();
    }
  }

  cleanupCooldowns() {
    const now = Date.now();
    for (const [key, time] of this.cooldowns.entries()) {
      if (now - time > 60000) { // 1 minute
        this.cooldowns.delete(key);
      }
    }
  }

  /**
   * Spam count management
   */
  getUserSpamCount(chatId, userId) {
    const key = `${chatId}:${userId}:spam`;
    return this.spamCounts.get(key) || 0;
  }

  updateUserSpamCount(chatId, userId) {
    const key = `${chatId}:${userId}:spam`;
    const current = this.getUserSpamCount(chatId, userId);
    this.spamCounts.set(key, current + 1);
    
    // Reset after 1 hour
    setTimeout(() => {
      this.spamCounts.delete(key);
    }, 3600000);
  }

  /**
   * Rate limit management
   */
  clearRateLimit(chatId, userId) {
    const key = `${chatId}:${userId}`;
    this.rateLimits.delete(key);
  }

  /**
   * Get recent user messages (simplified)
   */
  async getRecentUserMessages(chatId, userId) {
    // In production, you'd query the database
    // This returns dummy data for the example
    return [];
  }

  /**
   * Send warning message
   */
  async sendWarning(bot, chatId, userId, reason) {
    const userMention = `<a href="tg://user?id=${userId}">User</a>`;
    
    await bot.sendMessage(chatId,
      `⚠️ ${userMention}, ${reason}`,
      { parse_mode: 'HTML' }
    );
  }
}

// Initialize spam counts map
ModerationService.prototype.spamCounts = new Map();

module.exports = new ModerationService();

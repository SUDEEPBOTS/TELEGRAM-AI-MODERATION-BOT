const User = require('../database/models/User');
const Group = require('../database/models/Group');
const Log = require('../database/models/Log');
const geminiService = require('../services/geminiService');
const moderationService = require('../services/moderationService');
const adminHandler = require('./adminHandler');
const logger = require('../utils/logger');
const { isCommand } = require('../utils/helpers');

class MessageHandler {
  constructor() {
    this.userStates = new Map();
    this.messageCache = new Map();
  }
  
  async handleMessage(bot, msg) {
    try {
      // Ignore old messages
      if (Date.now() / 1000 - msg.date > 60) {
        return;
      }
      
      const chat = msg.chat;
      const from = msg.from;
      
      // Ignore messages from bots
      if (from.is_bot) return;
      
      // Log message
      await Log.log({
        type: 'MESSAGE',
        groupId: chat.id,
        userId: from.id,
        action: 'message_sent',
        details: {
          message_id: msg.message_id,
          text_length: msg.text?.length || 0,
          has_entities: !!msg.entities
        }
      });
      
      // Update user stats
      await this.updateUserStats(from);
      
      // Handle different chat types
      if (chat.type === 'private') {
        await this.handlePrivateMessage(bot, msg);
      } else {
        await this.handleGroupMessage(bot, msg);
      }
      
    } catch (error) {
      logger.error('Message handler error:', error);
    }
  }
  
  async handlePrivateMessage(bot, msg) {
    const from = msg.from;
    const text = msg.text || '';
    
    // Save or update user
    await User.findOrCreate(from);
    
    // Check if this is an appeal response
    if (this.userStates.has(from.id) && this.userStates.get(from.id).type === 'appeal') {
      await this.handleAppealResponse(bot, msg);
      return;
    }
    
    // Handle commands in private chat
    if (isCommand(text)) {
      await this.handlePrivateCommand(bot, msg);
      return;
    }
    
    // Default response in private chat
    const response = `Hello ${from.first_name}! 👋\n\n` +
      `I'm Yuki, an AI moderation bot for Telegram groups.\n` +
      `You can add me to your group and I'll help with moderation.\n\n` +
      `Use /help to see available commands.`;
    
    await bot.sendMessage(from.id, response);
  }
  
  async handleGroupMessage(bot, msg) {
    const chat = msg.chat;
    const from = msg.from;
    const text = msg.text || '';
    const messageId = msg.message_id;
    
    // Save group and user
    const group = await Group.findOrCreate(chat);
    const user = await User.findOrCreate(from);
    
    // Update group stats
    group.stats.totalMessages += 1;
    group.stats.lastActivity = new Date();
    await group.save();
    
    // Check if user is ignored
    if (group.isIgnored(from.id)) {
      return; // Ignore all messages from this user
    }
    
    // Check for bot mention
    const isMentioned = this.isBotMentioned(text, bot);
    
    // Handle commands
    if (isCommand(text)) {
      await this.handleGroupCommand(bot, msg, group, user);
      return;
    }
    
    // Handle bot mention for chat
    if (isMentioned) {
      await this.handleBotMention(bot, msg, group, user);
      return;
    }
    
    // AI Moderation (if enabled)
    if (group.settings.aiModeration && text.trim().length > 3) {
      await moderationService.analyzeAndAct(bot, msg, group, user);
    }
    
    // Blacklist check
    if (text && group.blacklist.length > 0) {
      await this.checkBlacklist(bot, msg, group);
    }
    
    // Reply to replies (if bot was mentioned in thread)
    if (msg.reply_to_message && msg.reply_to_message.from.id === bot.id) {
      await this.handleThreadReply(bot, msg, group, user);
    }
  }
  
  async handleGroupCommand(bot, msg, group, user) {
    const text = msg.text;
    const chatId = msg.chat.id;
    const from = msg.from;
    
    // Extract command and arguments
    const match = text.match(/^\/([a-zA-Z0-9_]+)(@\w+)?(?:\s+(.*))?$/);
    if (!match) return;
    
    const [, command, , args = ''] = match;
    
    // Check if user is admin for admin commands
    const isAdmin = group.isAdmin(from.id) || from.id === parseInt(process.env.TELEGRAM_OWNER_ID);
    
    // Handle different commands
    switch(command.toLowerCase()) {
      case 'ping':
        const start = Date.now();
        const message = await bot.sendMessage(chatId, 'Pinging...');
        const end = Date.now();
        await bot.editMessageText(
          `🏓 Pong!\n` +
          `• Latency: ${end - start}ms\n` +
          `• Uptime: ${process.uptime().toFixed(2)}s`,
          {
            chat_id: chatId,
            message_id: message.message_id
          }
        );
        break;
        
      case 'stats':
        const stats = await this.getStats(bot, group);
        await bot.sendMessage(chatId, stats, { parse_mode: 'HTML' });
        break;
        
      case 'refresh':
        if (!isAdmin) {
          await bot.sendMessage(chatId, '❌ Only admins can use this command.');
          return;
        }
        // Clear cache
        this.messageCache.clear();
        this.userStates.clear();
        await bot.sendMessage(chatId, '🔄 Bot cache refreshed successfully!');
        break;
        
      case 'setrules':
        if (!isAdmin) {
          await bot.sendMessage(chatId, '❌ Only admins can set rules.');
          return;
        }
        await this.handleSetRules(bot, msg, group, args);
        break;
        
      case 'approve':
        if (!isAdmin) {
          await bot.sendMessage(chatId, '❌ Only admins can approve users.');
          return;
        }
        await this.handleApproveUser(bot, msg, group, args);
        break;
        
      case 'ban':
      case 'mute':
      case 'kick':
      case 'warn':
      case 'unban':
      case 'unmute':
        if (!isAdmin) {
          await bot.sendMessage(chatId, '❌ Only admins can use moderation commands.');
          return;
        }
        await adminHandler.handleModerationCommand(bot, msg, command, args);
        break;
        
      case 'help':
        await this.sendHelp(bot, chatId, isAdmin);
        break;
        
      default:
        // Check for custom admin commands
        if (isAdmin) {
          const handled = await adminHandler.handleCustomCommand(bot, msg, command, args);
          if (!handled) {
            await bot.sendMessage(chatId, 'Unknown command. Use /help for available commands.');
          }
        }
    }
    
    // Log command usage
    await Log.log({
      type: 'COMMAND',
      groupId: chatId,
      userId: from.id,
      action: `command_${command}`,
      details: { command, args, isAdmin }
    });
  }
  
  async handlePrivateCommand(bot, msg) {
    const from = msg.from;
    const text = msg.text;
    
    const match = text.match(/^\/([a-zA-Z0-9_]+)(?:\s+(.*))?$/);
    if (!match) return;
    
    const [, command, args = ''] = match;
    
    switch(command.toLowerCase()) {
      case 'start':
        const welcome = `Welcome ${from.first_name}! 🎉\n\n` +
          `I'm Yuki, your AI moderation assistant.\n\n` +
          `🔹 Add me to your group\n` +
          `🔹 Make me admin with necessary permissions\n` +
          `🔹 I'll automatically moderate the group\n\n` +
          `Use /help to see all commands.`;
        await bot.sendMessage(from.id, welcome);
        break;
        
      case 'help':
        const helpText = `🤖 <b>Yuki AI Moderation Bot</b>\n\n` +
          `<b>Group Commands:</b>\n` +
          `/ping - Check bot latency\n` +
          `/stats - Get group statistics\n` +
          `/help - Show this help message\n\n` +
          `<b>Admin Commands:</b>\n` +
          `/ban [user] [reason] - Ban a user\n` +
          `/mute [user] [time] [reason] - Mute a user\n` +
          `/warn [user] [reason] - Warn a user\n` +
          `/unban [user] - Unban a user\n` +
          `/unmute [user] - Unmute a user\n` +
          `/approve [user] - Approve user to ignore list\n` +
          `/setrules [rules] - Set group rules\n` +
          `/refresh - Refresh bot cache\n\n` +
          `<b>Private Chat:</b>\n` +
          `/appeal - Appeal a ban/mute\n` +
          `/mystats - View your statistics`;
        await bot.sendMessage(from.id, helpText, { parse_mode: 'HTML' });
        break;
        
      case 'appeal':
        await this.handleAppealStart(bot, msg);
        break;
        
      case 'mystats':
        await this.handleUserStats(bot, msg);
        break;
        
      default:
        await bot.sendMessage(from.id, 'Unknown command. Use /help for available commands.');
    }
  }
  
  async handleBotMention(bot, msg, group, user) {
    const text = msg.text.replace(/@\w+/g, '').trim();
    
    if (text.length === 0) {
      await bot.sendMessage(msg.chat.id, 'Yes? How can I help? 😊');
      return;
    }
    
    // Get conversation history
    const history = await this.getMessageHistory(msg.chat.id, 5);
    
    // Generate AI response
    const response = await geminiService.chatResponse(text, history);
    
    // Send response
    await bot.sendMessage(msg.chat.id, response, {
      reply_to_message_id: msg.message_id,
      parse_mode: 'HTML'
    });
  }
  
  async handleThreadReply(bot, msg, group, user) {
    // Continue conversation in thread
    const history = await this.getMessageHistory(msg.chat.id, 10, msg.message_id);
    
    const response = await geminiService.chatResponse(msg.text, history);
    
    await bot.sendMessage(msg.chat.id, response, {
      reply_to_message_id: msg.message_id,
      parse_mode: 'HTML'
    });
  }
  
  async handleSetRules(bot, msg, group, rulesText) {
    const chatId = msg.chat.id;
    
    if (!rulesText.trim()) {
      await bot.sendMessage(chatId, 
        'Please provide rules text.\n' +
        'Example: /setrules No spam, No abuse, Be respectful'
      );
      return;
    }
    
    group.rules.text = rulesText;
    group.rules.lastUpdated = new Date();
    group.rules.updatedBy = msg.from.id;
    await group.save();
    
    await bot.sendMessage(chatId, '✅ Group rules updated successfully!');
  }
  
  async handleApproveUser(bot, msg, group, args) {
    const chatId = msg.chat.id;
    const from = msg.from;
    
    // Get target user from reply or username
    let targetUser;
    if (msg.reply_to_message) {
      targetUser = msg.reply_to_message.from;
    } else if (args) {
      // Extract username or ID from args
      const usernameMatch = args.match(/@(\w+)/);
      if (usernameMatch) {
        // In real implementation, you'd need to get user by username
        await bot.sendMessage(chatId, 'Please reply to the user\'s message or use their ID.');
        return;
      }
    } else {
      await bot.sendMessage(chatId, 'Please reply to the user or provide username.');
      return;
    }
    
    if (!targetUser) {
      await bot.sendMessage(chatId, 'Could not identify user.');
      return;
    }
    
    // Add to ignored users
    if (!group.isIgnored(targetUser.id)) {
      group.ignoredUsers.push({
        userId: targetUser.id,
        username: targetUser.username,
        ignoredBy: from.id,
        reason: 'Manually approved by admin'
      });
      await group.save();
      
      await bot.sendMessage(chatId, 
        `✅ User ${targetUser.first_name} (@${targetUser.username || 'no_username'}) ` +
        `added to approved list. They will be ignored by AI moderation.`
      );
    } else {
      await bot.sendMessage(chatId, 'User is already in approved list.');
    }
  }
  
  async handleAppealStart(bot, msg) {
    const from = msg.from;
    
    // Check if user has active bans/mutes
    const user = await User.findOne({ userId: from.id });
    if (!user) {
      await bot.sendMessage(from.id, 'No user data found.');
      return;
    }
    
    const activeBans = user.bans.filter(b => !b.unbanned);
    const activeMutes = user.mutes.filter(m => !m.unmuted && 
      (Date.now() - new Date(m.date).getTime()) < m.duration * 1000);
    
    if (activeBans.length === 0 && activeMutes.length === 0) {
      await bot.sendMessage(from.id, 'You don\'t have any active bans or mutes to appeal.');
      return;
    }
    
    // Set user state
    this.userStates.set(from.id, {
      type: 'appeal',
      step: 'select',
      bans: activeBans,
      mutes: activeMutes
    });
    
    // Create keyboard
    const keyboard = {
      inline_keyboard: []
    };
    
    activeBans.forEach((ban, index) => {
      keyboard.inline_keyboard.push([{
        text: `Appeal Ban #${index + 1} (${ban.groupId})`,
        callback_data: `appeal_select_ban_${index}`
      }]);
    });
    
    activeMutes.forEach((mute, index) => {
      keyboard.inline_keyboard.push([{
        text: `Appeal Mute #${index + 1} (${mute.groupId})`,
        callback_data: `appeal_select_mute_${index}`
      }]);
    });
    
    await bot.sendMessage(from.id, 
      'Select which ban/mute you want to appeal:',
      { reply_markup: keyboard }
    );
  }
  
  async handleAppealResponse(bot, msg) {
    const from = msg.from;
    const state = this.userStates.get(from.id);
    
    if (!state || state.type !== 'appeal') return;
    
    if (state.step === 'reason') {
      const appealText = msg.text;
      
      if (appealText.length < 10) {
        await bot.sendMessage(from.id, 'Please provide a detailed reason (at least 10 characters).');
        return;
      }
      
      // Create appeal
      const user = await User.findOne({ userId: from.id });
      const appeal = await user.createAppeal(state.targetGroupId, appealText);
      
      // Get group info
      const group = await Group.findOne({ groupId: state.targetGroupId });
      
      // Process appeal with AI
      const appealData = {
        userName: `${from.first_name} ${from.last_name || ''}`,
        userId: from.id,
        groupName: group?.title || 'Unknown Group',
        offense: state.offense,
        action: state.action,
        reason: appealText,
        totalWarnings: user.warnings.length,
        previousBans: user.bans.length,
        appealAttempts: user.appeals.length
      };
      
      const aiDecision = await geminiService.handleAppeal(appealData);
      
      // Update appeal with AI decision
      user.appeals[user.appeals.length - 1].aiDecision = aiDecision.decision;
      user.appeals[user.appeals.length - 1].aiReason = aiDecision.reason;
      
      if (aiDecision.decision === 'APPROVE' && user.appeals.length <= 3) {
        user.appeals[user.appeals.length - 1].status = 'APPROVED';
        await user.save();
        
        // Unban/Unmute user
        if (state.action === 'BAN') {
          await bot.unbanChatMember(state.targetGroupId, from.id);
          
          // Mark ban as unbanned
          const banIndex = user.bans.findIndex(b => 
            b.groupId === state.targetGroupId && !b.unbanned
          );
          if (banIndex !== -1) {
            user.bans[banIndex].unbanned = true;
            await user.save();
          }
        } else if (state.action === 'MUTE') {
          await bot.restrictChatMember(state.targetGroupId, from.id, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true
          });
          
          // Mark mute as unmuted
          const muteIndex = user.mutes.findIndex(m => 
            m.groupId === state.targetGroupId && !m.unmuted
          );
          if (muteIndex !== -1) {
            user.mutes[muteIndex].unmuted = true;
            await user.save();
          }
        }
        
        await bot.sendMessage(from.id, 
          `✅ Your appeal has been APPROVED!\n\n` +
          `Reason: ${aiDecision.reason}\n` +
          `Conditions: ${aiDecision.conditions.join(', ') || 'None'}\n` +
          `Probation: ${aiDecision.probation_days} days\n\n` +
          `You have been ${state.action === 'BAN' ? 'unbanned' : 'unmuted'} from the group.`
        );
        
        // Notify group admins
        if (group) {
          await bot.sendMessage(group.logs.logChatId || group.groupId,
            `📢 Appeal Approved\n` +
            `User: ${from.first_name} (@${from.username || 'no_username'})\n` +
            `Action: ${state.action}\n` +
            `AI Decision: ${aiDecision.reason}`
          );
        }
        
      } else if (aiDecision.decision === 'DENY') {
        user.appeals[user.appeals.length - 1].status = 'DENIED';
        await user.save();
        
        await bot.sendMessage(from.id,
          `❌ Your appeal has been DENIED.\n\n` +
          `Reason: ${aiDecision.reason}\n\n` +
          `You have ${3 - user.appeals.filter(a => a.status === 'DENIED').length} ` +
          `appeal attempts remaining before owner review.`
        );
        
      } else if (user.appeals.length >= 3) {
        user.appeals[user.appeals.length - 1].status = 'OWNER_REVIEW';
        await user.save();
        
        // Forward to owner
        const ownerId = process.env.TELEGRAM_OWNER_ID;
        if (ownerId) {
          await bot.sendMessage(ownerId,
            `👑 Owner Review Needed\n\n` +
            `User: ${from.first_name} (@${from.username || 'no_username'})\n` +
            `User ID: ${from.id}\n` +
            `Group: ${group?.title || state.targetGroupId}\n` +
            `Action: ${state.action}\n` +
            `Appeal: ${appealText}\n\n` +
            `Appeal attempts: ${user.appeals.length}\n` +
            `AI Recommendation: ${aiDecision.decision}\n` +
            `AI Reason: ${aiDecision.reason}`
          );
        }
        
        await bot.sendMessage(from.id,
          `⏳ Your appeal has been forwarded to the bot owner for review.\n` +
          `You will be notified of their decision.`
        );
      }
      
      // Clear user state
      this.userStates.delete(from.id);
    }
  }
  
  async checkBlacklist(bot, msg, group) {
    const text = msg.text.toLowerCase();
    
    for (const item of group.blacklist) {
      if (text.includes(item.word.toLowerCase())) {
        // Take action based on blacklist setting
        switch(item.action) {
          case 'DELETE':
            await bot.deleteMessage(msg.chat.id, msg.message_id);
            await bot.sendMessage(msg.chat.id, 
              `⚠️ Message deleted for containing blacklisted word: "${item.word}"`,
              { reply_to_message_id: msg.message_id }
            );
            break;
            
          case 'WARN':
            await moderationService.warnUser(bot, msg.chat.id, msg.from.id, 
              `Used blacklisted word: "${item.word}"`);
            break;
            
          case 'MUTE':
            await bot.restrictChatMember(msg.chat.id, msg.from.id, {
              until_date: Math.floor(Date.now() / 1000) + 3600, // 1 hour
              can_send_messages: false
            });
            await bot.sendMessage(msg.chat.id,
              `🔇 User muted for 1 hour for using blacklisted word: "${item.word}"`
            );
            break;
            
          case 'BAN':
            await bot.banChatMember(msg.chat.id, msg.from.id);
            await bot.sendMessage(msg.chat.id,
              `🚫 User banned for using blacklisted word: "${item.word}"`
            );
            break;
        }
        
        break; // Only take action on first match
      }
    }
  }
  
  async getStats(bot, group) {
    const totalUsers = await User.countDocuments();
    const totalGroups = await Group.countDocuments();
    
    const activeUsers = await User.countDocuments({
      'stats.lastSeen': { $gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });
    
    return `<b>📊 Bot Statistics</b>\n\n` +
      `<b>Global Stats:</b>\n` +
      `• Total Users: ${totalUsers}\n` +
      `• Active Users (7d): ${activeUsers}\n` +
      `• Total Groups: ${totalGroups}\n\n` +
      `<b>Group Stats:</b>\n` +
      `• Messages: ${group.stats.totalMessages}\n` +
      `• Bans: ${group.stats.totalBans}\n` +
      `• Mutes: ${group.stats.totalMutes}\n` +
      `• Warnings: ${group.stats.totalWarnings}\n\n` +
      `<b>AI Moderation:</b> ${group.settings.aiModeration ? '✅ Enabled' : '❌ Disabled'}\n` +
      `<b>Last Activity:</b> ${group.stats.lastActivity.toLocaleString()}`;
  }
  
  async sendHelp(bot, chatId, isAdmin) {
    let helpText = `<b>🤖 Yuki AI Moderation Bot</b>\n\n` +
      `<b>Available Commands:</b>\n` +
      `/ping - Check bot latency\n` +
      `/stats - Get group statistics\n` +
      `/help - Show this help\n\n`;
    
    if (isAdmin) {
      helpText += `<b>Admin Commands:</b>\n` +
        `/ban [user] - Ban a user\n` +
        `/mute [user] [time] - Mute a user\n` +
        `/warn [user] - Warn a user\n` +
        `/unban [user] - Unban a user\n` +
        `/unmute [user] - Unmute a user\n` +
        `/approve [user] - Approve user (ignore AI)\n` +
        `/setrules [text] - Set group rules\n` +
        `/refresh - Refresh bot cache\n\n` +
        `<b>Custom Commands:</b>\n` +
        `You can say "Yuki [action] [user]" and I'll do it!\n` +
        `Example: "Yuki ban @username" or "Yuki mute this user"\n\n`;
    }
    
    helpText += `<b>Features:</b>\n` +
      `• AI-powered moderation\n` +
      `• Automatic rule enforcement\n` +
      `• Appeal system\n` +
      `• Blacklist management\n` +
      `• Welcome messages\n` +
      `• Activity logging`;
    
    await bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
  }
  
  async handleUserStats(bot, msg) {
    const from = msg.from;
    const user = await User.findOne({ userId: from.id });
    
    if (!user) {
      await bot.sendMessage(from.id, 'No user data found.');
      return;
    }
    
    const stats = `<b>📈 Your Statistics</b>\n\n` +
      `<b>Basic Info:</b>\n` +
      `• Name: ${user.firstName} ${user.lastName || ''}\n` +
      `• Username: @${user.username || 'Not set'}\n` +
      `• User ID: ${user.userId}\n\n` +
      `<b>Moderation History:</b>\n` +
      `• Total Warnings: ${user.warnings.length}\n` +
      `• Total Bans: ${user.bans.filter(b => !b.unbanned).length} active\n` +
      `• Total Mutes: ${user.mutes.filter(m => !m.unmuted).length} active\n` +
      `• Appeals: ${user.appeals.length}\n\n` +
      `<b>Activity:</b>\n` +
      `• Messages Sent: ${user.stats.messagesSent}\n` +
      `• Commands Used: ${user.stats.commandsUsed}\n` +
      `• Last Seen: ${user.stats.lastSeen.toLocaleString()}`;
    
    await bot.sendMessage(from.id, stats, { parse_mode: 'HTML' });
  }
  
  async updateUserStats(userData) {
    await User.updateOne(
      { userId: userData.id },
      { 
        $inc: { 'stats.messagesSent': 1 },
        $set: { 'stats.lastSeen': new Date() }
      }
    );
  }
  
  async getMessageHistory(chatId, limit = 5, beforeId = null) {
    // This would require storing messages in database
    // For now, return empty array
    return [];
  }
  
  isBotMentioned(text, bot) {
    if (!text) return false;
    
    const botUsername = bot.options.username;
    return text.includes(`@${botUsername}`);
  }
}

module.exports = new MessageHandler();

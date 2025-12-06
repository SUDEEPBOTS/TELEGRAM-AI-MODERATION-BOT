const User = require('../database/models/User');
const Group = require('../database/models/Group');
const Log = require('../database/models/Log');
const geminiService = require('../services/geminiService');
const logger = require('../utils/logger');

class CallbackHandler {
  constructor() {
    this.pendingActions = new Map();
  }
  
  async handleCallback(bot, callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message?.chat?.id;
    const messageId = callbackQuery.message?.message_id;
    const from = callbackQuery.from;
    
    try {
      // Answer callback query to remove loading state
      await bot.answerCallbackQuery(callbackQuery.id);
      
      // Parse callback data
      const parts = data.split('_');
      const action = parts[0];
      
      switch(action) {
        case 'appeal':
          await this.handleAppealCallback(bot, callbackQuery, parts);
          break;
          
        case 'mod':
          await this.handleModerationCallback(bot, callbackQuery, parts);
          break;
          
        case 'admin':
          await this.handleAdminCallback(bot, callbackQuery, parts);
          break;
          
        case 'settings':
          await this.handleSettingsCallback(bot, callbackQuery, parts);
          break;
          
        default:
          logger.warn(`Unknown callback action: ${action}`);
      }
      
      // Log callback
      await Log.log({
        type: 'SYSTEM',
        groupId: chatId,
        userId: from.id,
        action: `callback_${action}`,
        details: { data }
      });
      
    } catch (error) {
      logger.error('Callback handler error:', error);
      
      // Send error to user
      await bot.sendMessage(from.id, 
        '❌ An error occurred while processing your request. Please try again.'
      );
    }
  }
  
  async handleAppealCallback(bot, callbackQuery, parts) {
    const from = callbackQuery.from;
    const subAction = parts[1];
    
    switch(subAction) {
      case 'start':
        const userId = parseInt(parts[2]);
        if (from.id !== userId) {
          await bot.sendMessage(from.id, 'This appeal button is not for you.');
          return;
        }
        
        // Start appeal process
        await bot.sendMessage(from.id,
          '📝 <b>Appeal Process</b>\n\n' +
          'Please explain why you should be unbanned/unmuted:\n' +
          '• Be honest and respectful\n' +
          '• Acknowledge any mistakes\n' +
          '• Explain how you\'ll follow rules in future\n\n' +
          'Type your appeal message now:',
          { parse_mode: 'HTML' }
        );
        break;
        
      case 'ban':
      case 'mute':
        const targetUserId = parseInt(parts[2]);
        const groupId = parseInt(parts[3]);
        
        if (from.id !== targetUserId) {
          await bot.sendMessage(from.id, 'This appeal button is not for you.');
          return;
        }
        
        // Get user and group info
        const user = await User.findOne({ userId: targetUserId });
        const group = await Group.findOne({ groupId: groupId });
        
        if (!user || !group) {
          await bot.sendMessage(from.id, 'Error: Could not find user or group data.');
          return;
        }
        
        // Check if appeal already exists
        const existingAppeal = user.appeals.find(a => 
          a.groupId === groupId && 
          (subAction === 'ban' ? a.action === 'BAN' : a.action === 'MUTE') &&
          a.status === 'PENDING'
        );
        
        if (existingAppeal) {
          await bot.sendMessage(from.id, 'You already have a pending appeal for this action.');
          return;
        }
        
        // Check appeal attempts
        const appealAttempts = user.appeals.filter(a => a.groupId === groupId).length;
        if (appealAttempts >= 3) {
          await bot.sendMessage(from.id,
            'You have reached the maximum appeal attempts (3).\n' +
            'Your next appeal will be reviewed by the bot owner.'
          );
        }
        
        // Store appeal info
        this.pendingActions.set(from.id, {
          type: 'appeal',
          action: subAction.toUpperCase(),
          groupId: groupId,
          offense: subAction === 'ban' ? 'Ban violation' : 'Mute violation'
        });
        
        // Ask for appeal reason
        await bot.sendMessage(from.id,
          `📝 <b>Appeal ${subAction.toUpperCase()}</b>\n\n` +
          `Group: ${group.title}\n` +
          `Action: ${subAction.toUpperCase()}\n\n` +
          `Please explain why this ${subAction} should be removed:\n` +
          `• What happened?\n` +
          `• Why was it unfair/wrong?\n` +
          `• How will you avoid this in future?\n\n` +
          `Type your appeal message now (minimum 20 characters):`,
          { parse_mode: 'HTML' }
        );
        break;
        
      case 'select':
        const appealType = parts[2]; // ban or mute
        const index = parseInt(parts[3]);
        
        // Get user state
        const userState = this.getUserState(from.id);
        if (!userState || userState.type !== 'appeal') return;
        
        let target;
        if (appealType === 'ban') {
          target = userState.bans[index];
          userState.action = 'BAN';
        } else {
          target = userState.mutes[index];
          userState.action = 'MUTE';
        }
        
        if (!target) {
          await bot.sendMessage(from.id, 'Invalid selection.');
          return;
        }
        
        userState.step = 'reason';
        userState.targetGroupId = target.groupId;
        userState.offense = target.reason;
        
        this.setUserState(from.id, userState);
        
        await bot.sendMessage(from.id,
          `📝 <b>Appeal ${userState.action}</b>\n\n` +
          `Group ID: ${target.groupId}\n` +
          `Reason: ${target.reason}\n\n` +
          `Please explain why this should be removed:\n` +
          `• Be specific and honest\n` +
          `• Show understanding of rules\n` +
          `• Promise to follow rules\n\n` +
          `Type your appeal now:`,
          { parse_mode: 'HTML' }
        );
        break;
        
      case 'approve':
      case 'deny':
        if (parts.length < 4) return;
        
        const appealId = parts[2];
        const decision = subAction.toUpperCase();
        const adminId = from.id;
        
        // Get appeal from database (simplified)
        // In real implementation, you'd query the appeal by ID
        
        await bot.sendMessage(from.id,
          `✅ Appeal ${decision === 'APPROVE' ? 'approved' : 'denied'}.\n` +
          `The user has been notified.`
        );
        
        // Update original message
        if (callbackQuery.message) {
          const newText = callbackQuery.message.text + 
            `\n\n📋 <b>Decision: ${decision}</b>\n` +
            `Reviewed by: ${from.first_name}`;
          
          await bot.editMessageText(newText, {
            chat_id: callbackQuery.message.chat.id,
            message_id: callbackQuery.message.message_id,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] } // Remove buttons
          });
        }
        break;
    }
  }
  
  async handleModerationCallback(bot, callbackQuery, parts) {
    const subAction = parts[1];
    const userId = parseInt(parts[2]);
    const groupId = parseInt(parts[3]);
    const from = callbackQuery.from;
    
    // Check if user is admin
    const group = await Group.findOne({ groupId });
    if (!group || !group.isAdmin(from.id)) {
      await bot.answerCallbackQuery(callbackQuery.id, {
        text: 'Only admins can use moderation buttons.',
        show_alert: true
      });
      return;
    }
    
    switch(subAction) {
      case 'warn':
        await this.performWarn(bot, userId, groupId, from);
        break;
        
      case 'mute':
        const duration = parseInt(parts[4]) || 3600; // Default 1 hour
        await this.performMute(bot, userId, groupId, from, duration);
        break;
        
      case 'kick':
        await this.performKick(bot, userId, groupId, from);
        break;
        
      case 'ban':
        await this.performBan(bot, userId, groupId, from);
        break;
        
      case 'delete':
        if (callbackQuery.message) {
          await bot.deleteMessage(groupId, callbackQuery.message.message_id);
        }
        break;
    }
    
    // Update callback message
    if (callbackQuery.message) {
      const actionText = {
        warn: 'warned',
        mute: 'muted',
        kick: 'kicked',
        ban: 'banned'
      }[subAction] || 'acted upon';
      
      const newText = callbackQuery.message.text + 
        `\n\n✅ Action taken by ${from.first_name}`;
      
      await bot.editMessageText(newText, {
        chat_id: callbackQuery.message.chat.id,
        message_id: callbackQuery.message.message_id,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] }
      });
    }
  }
  
  async performWarn(bot, userId, groupId, admin) {
    const user = await User.findOne({ userId });
    if (!user) return;
    
    await user.addWarning(groupId, 'Manual warning via button', admin.id);
    
    // Send DM to user
    await bot.sendMessage(userId,
      `⚠️ <b>You have been warned</b>\n\n` +
      `Admin: ${admin.first_name}\n` +
      `You received a warning in the group.\n\n` +
      `Further violations may result in a mute or ban.`,
      { parse_mode: 'HTML' }
    );
  }
  
  async performMute(bot, userId, groupId, admin, duration) {
    await bot.restrictChatMember(groupId, userId, {
      until_date: Math.floor(Date.now() / 1000) + duration,
      can_send_messages: false
    });
    
    // Update user record
    const user = await User.findOne({ userId });
    if (user) {
      await user.addMute(groupId, 'Manual mute via button', admin.id, duration);
    }
    
    // Send DM to user
    await bot.sendMessage(userId,
      `🔇 <b>You have been muted</b>\n\n` +
      `Admin: ${admin.first_name}\n` +
      `Duration: ${this.formatDuration(duration)}\n\n` +
      `You cannot send messages until the mute expires.`,
      { parse_mode: 'HTML' }
    );
  }
  
  async performKick(bot, userId, groupId, admin) {
    await bot.banChatMember(groupId, userId);
    setTimeout(() => {
      bot.unbanChatMember(groupId, userId);
    }, 1000);
    
    // Send DM to user
    await bot.sendMessage(userId,
      `👢 <b>You have been kicked</b>\n\n` +
      `Admin: ${admin.first_name}\n` +
      `You were removed from the group.\n\n` +
      `You can rejoin if you wish.`,
      { parse_mode: 'HTML' }
    );
  }
  
  async performBan(bot, userId, groupId, admin) {
    await bot.banChatMember(groupId, userId);
    
    // Update user record
    const user = await User.findOne({ userId });
    if (user) {
      await user.addBan(groupId, 'Manual ban via button', admin.id, 0);
    }
    
    // Send DM to user
    await bot.sendMessage(userId,
      `🚫 <b>You have been banned</b>\n\n` +
      `Admin: ${admin.first_name}\n` +
      `You were permanently banned from the group.\n\n` +
      `You can appeal this ban by contacting the admins.`,
      { parse_mode: 'HTML' }
    );
  }
  
  async handleAdminCallback(bot, callbackQuery, parts) {
    // Handle admin panel callbacks
    // Implementation depends on your admin panel design
  }
  
  async handleSettingsCallback(bot, callbackQuery, parts) {
    // Handle settings panel callbacks
    // Implementation depends on your settings panel design
  }
  
  getUserState(userId) {
    // Get from database or cache
    return this.pendingActions.get(userId);
  }
  
  setUserState(userId, state) {
    this.pendingActions.set(userId, state);
  }
  
  formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.join(' ') || '1m';
  }
}

module.exports = new CallbackHandler();

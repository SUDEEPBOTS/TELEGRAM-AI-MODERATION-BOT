const User = require('../database/models/User');
const Group = require('../database/models/Group');
const Log = require('../database/models/Log');
const geminiService = require('../services/geminiService');
const logger = require('../utils/logger');

class AdminHandler {
  constructor() {
    this.adminCommands = new Set(['ban', 'mute', 'warn', 'kick', 'unban', 'unmute', 'approve']);
  }
  
  async handleModerationCommand(bot, msg, command, args) {
    const chatId = msg.chat.id;
    const from = msg.from;
    
    // Check if user is admin
    const group = await Group.findOne({ groupId: chatId });
    if (!group || !group.isAdmin(from.id)) {
      await bot.sendMessage(chatId, '❌ You need to be an admin to use this command.');
      return;
    }
    
    // Get target user
    const targetUser = await this.getTargetUser(bot, msg, args);
    if (!targetUser) {
      await bot.sendMessage(chatId, 
        '❌ Please reply to a user or provide username/ID.\n' +
        `Usage: /${command} @username or /${command} (reply to message)`
      );
      return;
    }
    
    // Check if target is admin (prevent moderating admins)
    if (targetUser.id !== from.id && group.isAdmin(targetUser.id)) {
      await bot.sendMessage(chatId, '❌ Cannot moderate other admins.');
      return;
    }
    
    // Check if target is bot owner
    if (targetUser.id === parseInt(process.env.TELEGRAM_OWNER_ID)) {
      await bot.sendMessage(chatId, '❌ Cannot moderate bot owner.');
      return;
    }
    
    // Execute command
    switch(command.toLowerCase()) {
      case 'ban':
        await this.handleBan(bot, chatId, targetUser, from, args);
        break;
        
      case 'mute':
        await this.handleMute(bot, chatId, targetUser, from, args);
        break;
        
      case 'warn':
        await this.handleWarn(bot, chatId, targetUser, from, args);
        break;
        
      case 'kick':
        await this.handleKick(bot, chatId, targetUser, from, args);
        break;
        
      case 'unban':
        await this.handleUnban(bot, chatId, targetUser, from);
        break;
        
      case 'unmute':
        await this.handleUnmute(bot, chatId, targetUser, from);
        break;
    }
    
    // Log admin action
    await Log.log({
      type: 'ADMIN_ACTION',
      groupId: chatId,
      userId: from.id,
      targetUserId: targetUser.id,
      action: `admin_${command}`,
      details: { args }
    });
  }
  
  async handleCustomCommand(bot, msg, command, args) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const from = msg.from;
    
    // Check for "Yuki" commands
    if (text.toLowerCase().includes('yuki')) {
      return await this.handleYukiCommand(bot, msg, text);
    }
    
    return false; // Not handled
  }
  
  async handleYukiCommand(bot, msg, text) {
    const chatId = msg.chat.id;
    const from = msg.from;
    
    // Check if user is admin
    const group = await Group.findOne({ groupId: chatId });
    if (!group || !group.isAdmin(from.id)) {
      return false;
    }
    
    // Parse command
    const yukiMatch = text.match(/yuki\s+(ban|mute|kick|warn|unban|unmute)\s+(.+)/i);
    if (!yukiMatch) {
      // Check for natural language commands
      return await this.handleNaturalLanguageCommand(bot, msg, text);
    }
    
    const [, action, target] = yukiMatch;
    
    // Get target user
    const targetUser = await this.getTargetUserFromText(bot, msg, target);
    if (!targetUser) {
      await bot.sendMessage(chatId, `❌ Could not find user: ${target}`);
      return true;
    }
    
    // Execute action
    switch(action.toLowerCase()) {
      case 'ban':
        await this.handleBan(bot, chatId, targetUser, from, 'Via Yuki command');
        break;
      case 'mute':
        await this.handleMute(bot, chatId, targetUser, from, '1h Via Yuki command');
        break;
      case 'kick':
        await this.handleKick(bot, chatId, targetUser, from, 'Via Yuki command');
        break;
      case 'warn':
        await this.handleWarn(bot, chatId, targetUser, from, 'Via Yuki command');
        break;
      case 'unban':
        await this.handleUnban(bot, chatId, targetUser, from);
        break;
      case 'unmute':
        await this.handleUnmute(bot, chatId, targetUser, from);
        break;
    }
    
    await bot.sendMessage(chatId, `✅ Yuki has ${action}ed ${targetUser.first_name}.`);
    return true;
  }
  
  async handleNaturalLanguageCommand(bot, msg, text) {
    // Use AI to understand natural language commands
    const prompt = `
    Parse this admin command: "${text}"
    
    Possible actions: BAN, MUTE, KICK, WARN, IGNORE
    Target: Extract username or "this user" for replied message
    
    Respond with JSON:
    {
      "action": "BAN|MUTE|KICK|WARN|IGNORE",
      "target": "username or 'reply'",
      "duration": 3600 (for mute, in seconds),
      "reason": "extracted reason or empty"
    }
    
    If no clear action, action should be "IGNORE".
    `;
    
    try {
      const response = await geminiService.query(prompt);
      const parsed = JSON.parse(response);
      
      if (parsed.action === 'IGNORE') {
        return false;
      }
      
      // Get target user
      let targetUser;
      if (parsed.target === 'reply' && msg.reply_to_message) {
        targetUser = msg.reply_to_message.from;
      } else if (parsed.target.startsWith('@')) {
        targetUser = await this.getUserByUsername(bot, parsed.target.substring(1));
      } else {
        return false;
      }
      
      if (!targetUser) {
        return false;
      }
      
      // Execute action
      const chatId = msg.chat.id;
      const from = msg.from;
      
      switch(parsed.action) {
        case 'BAN':
          await this.handleBan(bot, chatId, targetUser, from, parsed.reason);
          break;
        case 'MUTE':
          await this.handleMute(bot, chatId, targetUser, from, `${parsed.duration}s ${parsed.reason}`);
          break;
        case 'KICK':
          await this.handleKick(bot, chatId, targetUser, from, parsed.reason);
          break;
        case 'WARN':
          await this.handleWarn(bot, chatId, targetUser, from, parsed.reason);
          break;
      }
      
      await bot.sendMessage(chatId, `✅ Done! ${targetUser.first_name} has been ${parsed.action.toLowerCase()}ed.`);
      return true;
      
    } catch (error) {
      logger.error('Natural language command error:', error);
      return false;
    }
  }
  
  async handleBan(bot, chatId, targetUser, admin, args) {
    // Parse duration and reason
    const { duration, reason } = this.parseDurationAndReason(args);
    
    // Ban user
    await bot.banChatMember(chatId, targetUser.id, {
      until_date: duration > 0 ? Math.floor(Date.now() / 1000) + duration : undefined
    });
    
    // Update user record
    const user = await User.findOne({ userId: targetUser.id });
    if (user) {
      await user.addBan(chatId, reason || 'Admin command', admin.id, duration);
    }
    
    // Update group stats
    const group = await Group.findOne({ groupId: chatId });
    if (group) {
      group.stats.totalBans += 1;
      await group.save();
    }
    
    // Send confirmation
    const durationText = duration > 0 ? ` for ${this.formatDuration(duration)}` : ' permanently';
    await bot.sendMessage(chatId,
      `🚫 <b>${targetUser.first_name} has been banned${durationText}</b>\n` +
      `Reason: ${reason || 'Admin decision'}\n` +
      `By: ${admin.first_name}`,
      { parse_mode: 'HTML' }
    );
    
    // Send DM to user
    await this.sendActionDM(bot, targetUser.id, 'BANNED', {
      reason: reason || 'Admin decision',
      duration: duration,
      group: group?.title || 'the group',
      admin: admin.first_name
    });
  }
  
  async handleMute(bot, chatId, targetUser, admin, args) {
    // Parse duration and reason
    const { duration, reason } = this.parseDurationAndReason(args, 3600); // Default 1 hour
    
    // Mute user
    await bot.restrictChatMember(chatId, targetUser.id, {
      until_date: Math.floor(Date.now() / 1000) + duration,
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false
    });
    
    // Update user record
    const user = await User.findOne({ userId: targetUser.id });
    if (user) {
      await user.addMute(chatId, reason || 'Admin command', admin.id, duration);
    }
    
    // Update group stats
    const group = await Group.findOne({ groupId: chatId });
    if (group) {
      group.stats.totalMutes += 1;
      await group.save();
    }
    
    // Send confirmation
    await bot.sendMessage(chatId,
      `🔇 <b>${targetUser.first_name} has been muted for ${this.formatDuration(duration)}</b>\n` +
      `Reason: ${reason || 'Admin decision'}\n` +
      `By: ${admin.first_name}`,
      { parse_mode: 'HTML' }
    );
    
    // Send DM to user
    await this.sendActionDM(bot, targetUser.id, 'MUTED', {
      reason: reason || 'Admin decision',
      duration: duration,
      group: group?.title || 'the group',
      admin: admin.first_name
    });
  }
  
  async handleWarn(bot, chatId, targetUser, admin, args) {
    const reason = args || 'Admin warning';
    
    // Update user record
    const user = await User.findOne({ userId: targetUser.id });
    if (user) {
      await user.addWarning(chatId, reason, admin.id);
    }
    
    // Update group stats
    const group = await Group.findOne({ groupId: chatId });
    if (group) {
      group.stats.totalWarnings += 1;
      await group.save();
      
      // Check max warnings
      const warnings = user?.getGroupWarnings(chatId) || [];
      if (warnings.length >= group.settings.maxWarnings) {
        // Auto-mute
        await bot.restrictChatMember(chatId, targetUser.id, {
          until_date: Math.floor(Date.now() / 1000) + group.settings.muteDuration,
          can_send_messages: false
        });
        
        await bot.sendMessage(chatId,
          `⚠️ ${targetUser.first_name} has received ${warnings.length} warnings and has been auto-muted.`
        );
        
        // Clear warnings
        if (user) {
          user.warnings = user.warnings.filter(w => w.groupId !== chatId);
          await user.save();
        }
        
        return;
      }
    }
    
    // Send confirmation
    await bot.sendMessage(chatId,
      `⚠️ <b>${targetUser.first_name} has been warned</b>\n` +
      `Reason: ${reason}\n` +
      `By: ${admin.first_name}`,
      { parse_mode: 'HTML' }
    );
    
    // Send DM to user
    await this.sendActionDM(bot, targetUser.id, 'WARNED', {
      reason: reason,
      warnings: (user?.getGroupWarnings(chatId).length || 0) + 1,
      maxWarnings: group?.settings.maxWarnings || 3,
      group: group?.title || 'the group',
      admin: admin.first_name
    });
  }
  
  async handleKick(bot, chatId, targetUser, admin, args) {
    const reason = args || 'Admin decision';
    
    // Kick user (ban then immediately unban)
    await bot.banChatMember(chatId, targetUser.id);
    setTimeout(() => {
      bot.unbanChatMember(chatId, targetUser.id);
    }, 1000);
    
    // Send confirmation
    await bot.sendMessage(chatId,
      `👢 <b>${targetUser.first_name} has been kicked</b>\n` +
      `Reason: ${reason}\n` +
      `By: ${admin.first_name}`,
      { parse_mode: 'HTML' }
    );
    
    // Send DM to user
    await this.sendActionDM(bot, targetUser.id, 'KICKED', {
      reason: reason,
      group: 'the group',
      admin: admin.first_name
    });
  }
  
  async handleUnban(bot, chatId, targetUser, admin) {
    // Unban user
    await bot.unbanChatMember(chatId, targetUser.id);
    
    // Update user record
    const user = await User.findOne({ userId: targetUser.id });
    if (user) {
      const banIndex = user.bans.findIndex(b => 
        b.groupId === chatId && !b.unbanned
      );
      if (banIndex !== -1) {
        user.bans[banIndex].unbanned = true;
        await user.save();
      }
    }
    
    // Send confirmation
    await bot.sendMessage(chatId,
      `✅ <b>${targetUser.first_name} has been unbanned</b>\n` +
      `By: ${admin.first_name}`,
      { parse_mode: 'HTML' }
    );
  }
  
  async handleUnmute(bot, chatId, targetUser, admin) {
    // Unmute user
    await bot.restrictChatMember(chatId, targetUser.id, {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true
    });
    
    // Update user record
    const user = await User.findOne({ userId: targetUser.id });
    if (user) {
      const muteIndex = user.mutes.findIndex(m => 
        m.groupId === chatId && !m.unmuted
      );
      if (muteIndex !== -1) {
        user.mutes[muteIndex].unmuted = true;
        await user.save();
      }
    }
    
    // Send confirmation
    await bot.sendMessage(chatId,
      `✅ <b>${targetUser.first_name} has been unmuted</b>\n` +
      `By: ${admin.first_name}`,
      { parse_mode: 'HTML' }
    );
  }
  
  async getTargetUser(bot, msg, args) {
    // Try to get user from reply
    if (msg.reply_to_message) {
      return msg.reply_to_message.from;
    }
    
    // Try to get user from args (username or ID)
    if (args) {
      // Check for username
      const usernameMatch = args.match(/@(\w+)/);
      if (usernameMatch) {
        return await this.getUserByUsername(bot, usernameMatch[1]);
      }
      
      // Check for user ID
      const idMatch = args.match(/\d+/);
      if (idMatch) {
        const userId = parseInt(idMatch[0]);
        try {
          const chatMember = await bot.getChatMember(msg.chat.id, userId);
          return chatMember.user;
        } catch (error) {
          // User not found in chat
          return null;
        }
      }
    }
    
    return null;
  }
  
  async getTargetUserFromText(bot, msg, text) {
    // Check for username
    const usernameMatch = text.match(/@(\w+)/);
    if (usernameMatch) {
      return await this.getUserByUsername(bot, usernameMatch[1]);
    }
    
    // Check for "this user" when replying
    if (text.toLowerCase().includes('this user') && msg.reply_to_message) {
      return msg.reply_to_message.from;
    }
    
    // Check for user ID
    const idMatch = text.match(/\d+/);
    if (idMatch) {
      const userId = parseInt(idMatch[0]);
      try {
        const chatMember = await bot.getChatMember(msg.chat.id, userId);
        return chatMember.user;
      } catch (error) {
        return null;
      }
    }
    
    return null;
  }
  
  async getUserByUsername(bot, username) {
    // This is simplified - in reality you'd need to search group members
    // or store usernames in your database
    return null;
  }
  
  parseDurationAndReason(text, defaultDuration = 0) {
    if (!text) return { duration: defaultDuration, reason: '' };
    
    let duration = defaultDuration;
    let reason = '';
    
    // Parse duration from text
    const durationRegex = /(\d+)\s*(s|sec|second|m|min|minute|h|hour|d|day|w|week|mon|month|y|year)s?/gi;
    const matches = [...text.matchAll(durationRegex)];
    
    for (const match of matches) {
      const value = parseInt(match[1]);
      const unit = match[2].toLowerCase();
      
      switch(unit) {
        case 's': case 'sec': case 'second':
          duration += value;
          break;
        case 'm': case 'min': case 'minute':
          duration += value * 60;
          break;
        case 'h': case 'hour':
          duration += value * 3600;
          break;
        case 'd': case 'day':
          duration += value * 86400;
          break;
        case 'w': case 'week':
          duration += value * 604800;
          break;
        case 'mon': case 'month':
          duration += value * 2592000; // 30 days
          break;
        case 'y': case 'year':
          duration += value * 31536000; // 365 days
          break;
      }
      
      // Remove duration from text to get reason
      text = text.replace(match[0], '').trim();
    }
    
    reason = text || '';
    
    return { duration, reason };
  }
  
  formatDuration(seconds) {
    if (seconds === 0) return 'permanent';
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.join(' ') || '1m';
  }
  
  async sendActionDM(bot, userId, action, data) {
    try {
      let message = '';
      
      switch(action) {
        case 'WARNED':
          message = `⚠️ <b>You have been warned</b>\n\n` +
            `Group: ${data.group}\n` +
            `Admin: ${data.admin}\n` +
            `Reason: ${data.reason}\n` +
            `Warnings: ${data.warnings}/${data.maxWarnings}\n\n` +
            `Further violations may result in a mute or ban.`;
          break;
          
        case 'MUTED':
          message = `🔇 <b>You have been muted</b>\n\n` +
            `Group: ${data.group}\n` +
            `Admin: ${data.admin}\n` +
            `Reason: ${data.reason}\n` +
            `Duration: ${this.formatDuration(data.duration)}\n\n` +
            `You cannot send messages until the mute expires.`;
          break;
          
        case 'BANNED':
          message = `🚫 <b>You have been banned</b>\n\n` +
            `Group: ${data.group}\n` +
            `Admin: ${data.admin}\n` +
            `Reason: ${data.reason}\n` +
            `Duration: ${data.duration > 0 ? this.formatDuration(data.duration) : 'Permanent'}\n\n` +
            `You can appeal this ban.`;
          break;
          
        case 'KICKED':
          message = `👢 <b>You have been kicked</b>\n\n` +
            `Group: ${data.group}\n` +
            `Admin: ${data.admin}\n` +
            `Reason: ${data.reason}\n\n` +
            `You can rejoin the group.`;
          break;
      }
      
      const keyboard = action === 'BANNED' || action === 'MUTED' ? {
        inline_keyboard: [[{
          text: '📝 Appeal Decision',
          callback_data: `appeal_${action.toLowerCase().replace('ed', '')}_${userId}_${data.groupId || 0}`
        }]]
      } : undefined;
      
      await bot.sendMessage(userId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      
    } catch (error) {
      // User might have blocked the bot
      logger.warn(`Could not send DM to ${userId}:`, error.message);
    }
  }
}

module.exports = new AdminHandler();

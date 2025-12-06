const User = require('../database/models/User');
const Group = require('../database/models/Group');
const Log = require('../database/models/Log');
const geminiService = require('../services/geminiService');
const logger = require('../utils/logger');

class ModerationHandler {
  constructor() {
    this.cooldowns = new Map();
  }
  
  async analyzeAndAct(bot, msg, group, user) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageId = msg.message_id;
    const text = msg.text || '';
    
    // Check cooldown
    const cooldownKey = `${chatId}:${userId}`;
    if (this.cooldowns.has(cooldownKey)) {
      const lastCheck = this.cooldowns.get(cooldownKey);
      if (Date.now() - lastCheck < 5000) { // 5 second cooldown
        return;
      }
    }
    this.cooldowns.set(cooldownKey, Date.now());
    
    // Prepare context for AI
    const context = {
      senderName: `${msg.from.first_name} ${msg.from.last_name || ''}`,
      groupName: msg.chat.title,
      warnings: user.getGroupWarnings(chatId).length,
      isAdmin: group.isAdmin(userId)
    };
    
    // Get AI moderation decision
    const decision = await geminiService.moderateMessage(text, context);
    
    // Log AI decision
    await Log.log({
      type: 'MOD_ACTION',
      groupId: chatId,
      userId: userId,
      action: `ai_analysis`,
      details: decision
    });
    
    // Take action based on AI decision
    if (decision.action !== 'IGNORE') {
      await this.executeAction(bot, chatId, userId, messageId, decision, group, user);
    }
  }
  
  async executeAction(bot, chatId, userId, messageId, decision, group, user) {
    try {
      const userMention = `<a href="tg://user?id=${userId}">User</a>`;
      
      switch(decision.action) {
        case 'DELETE':
          await bot.deleteMessage(chatId, messageId);
          if (decision.response) {
            await bot.sendMessage(chatId, decision.response, {
              parse_mode: 'HTML'
            });
          }
          break;
          
        case 'WARN':
          await this.warnUser(bot, chatId, userId, decision.reason);
          
          if (decision.response) {
            await bot.sendMessage(chatId, decision.response, {
              parse_mode: 'HTML'
            });
          }
          break;
          
        case 'MUTE':
          const muteDuration = decision.duration || group.settings.muteDuration;
          await bot.restrictChatMember(chatId, userId, {
            until_date: Math.floor(Date.now() / 1000) + muteDuration,
            can_send_messages: false,
            can_send_media_messages: false,
            can_send_other_messages: false,
            can_add_web_page_previews: false
          });
          
          // Add to user's mute history
          await user.addMute(chatId, decision.reason, bot.id, muteDuration);
          
          // Update group stats
          group.stats.totalMutes += 1;
          await group.save();
          
          // Send DM to user
          await this.sendActionDM(bot, userId, 'MUTED', {
            reason: decision.reason,
            duration: muteDuration,
            group: group.title
          });
          
          // Send group message
          const muteMessage = decision.response || 
            `🔇 ${userMention} has been muted for ${this.formatDuration(muteDuration)}.\n` +
            `Reason: ${decision.reason}`;
          
          await bot.sendMessage(chatId, muteMessage, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{
                text: '📝 Appeal Mute',
                callback_data: `appeal_mute_${userId}_${chatId}`
              }]]
            }
          });
          break;
          
        case 'KICK':
          await bot.banChatMember(chatId, userId);
          setTimeout(() => {
            bot.unbanChatMember(chatId, userId);
          }, 1000);
          
          // Send DM
          await this.sendActionDM(bot, userId, 'KICKED', {
            reason: decision.reason,
            group: group.title
          });
          
          // Send group message
          const kickMessage = decision.response || 
            `👢 ${userMention} has been kicked.\nReason: ${decision.reason}`;
          
          await bot.sendMessage(chatId, kickMessage, {
            parse_mode: 'HTML'
          });
          break;
          
        case 'BAN':
          const banDuration = decision.duration || group.settings.banDuration;
          await bot.banChatMember(chatId, userId, {
            until_date: banDuration > 0 ? Math.floor(Date.now() / 1000) + banDuration : undefined
          });
          
          // Add to user's ban history
          await user.addBan(chatId, decision.reason, bot.id, banDuration);
          
          // Update group stats
          group.stats.totalBans += 1;
          await group.save();
          
          // Send DM to user
          await this.sendActionDM(bot, userId, 'BANNED', {
            reason: decision.reason,
            duration: banDuration,
            group: group.title
          });
          
          // Send group message
          const banMessage = decision.response || 
            `🚫 ${userMention} has been banned${banDuration > 0 ? ` for ${this.formatDuration(banDuration)}` : ' permanently'}.\n` +
            `Reason: ${decision.reason}`;
          
          await bot.sendMessage(chatId, banMessage, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[{
                text: '📝 Appeal Ban',
                callback_data: `appeal_ban_${userId}_${chatId}`
              }]]
            }
          });
          break;
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
          message: decision.response
        }
      });
      
    } catch (error) {
      logger.error(`Error executing action ${decision.action}:`, error);
      
      // Log error
      await Log.log({
        type: 'ERROR',
        groupId: chatId,
        action: `action_failed`,
        details: {
          action: decision.action,
          error: error.message,
          userId: userId
        }
      });
    }
  }
  
  async warnUser(bot, chatId, userId, reason) {
    const user = await User.findOne({ userId });
    if (!user) return;
    
    // Add warning
    await user.addWarning(chatId, reason, bot.id);
    
    // Get group
    const group = await Group.findOne({ groupId: chatId });
    if (!group) return;
    
    // Update group stats
    group.stats.totalWarnings += 1;
    await group.save();
    
    // Check if user reached max warnings
    const warnings = user.getGroupWarnings(chatId);
    if (warnings.length >= group.settings.maxWarnings) {
      // Auto-mute for reaching max warnings
      await bot.restrictChatMember(chatId, userId, {
        until_date: Math.floor(Date.now() / 1000) + group.settings.muteDuration,
        can_send_messages: false
      });
      
      await bot.sendMessage(chatId,
        `⚠️ ${user.firstName} has received ${warnings.length} warnings and has been muted for ${this.formatDuration(group.settings.muteDuration)}.`
      );
      
      // Clear warnings after mute
      user.warnings = user.warnings.filter(w => w.groupId !== chatId);
      await user.save();
    }
    
    // Send DM to user
    await this.sendActionDM(bot, userId, 'WARNED', {
      reason: reason,
      warnings: warnings.length,
      maxWarnings: group.settings.maxWarnings,
      group: group.title
    });
  }
  
  async sendActionDM(bot, userId, action, data) {
    try {
      let message = '';
      
      switch(action) {
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
            `Duration: ${this.formatDuration(data.duration)}\n\n` +
            `You cannot send messages in the group until the mute expires.`;
          break;
          
        case 'BANNED':
          message = `🚫 <b>You have been banned</b>\n\n` +
            `Group: ${data.group}\n` +
            `Reason: ${data.reason}\n` +
            `Duration: ${data.duration > 0 ? this.formatDuration(data.duration) : 'Permanent'}\n\n` +
            `You can appeal this ban by clicking the button below.`;
          break;
          
        case 'KICKED':
          message = `👢 <b>You have been kicked</b>\n\n` +
            `Group: ${data.group}\n` +
            `Reason: ${data.reason}\n\n` +
            `You can rejoin the group if you wish.`;
          break;
      }
      
      const keyboard = action === 'BANNED' || action === 'MUTED' ? {
        inline_keyboard: [[{
          text: '📝 Appeal Decision',
          callback_data: `appeal_start_${userId}`
        }]]
      } : undefined;
      
      await bot.sendMessage(userId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
      
    } catch (error) {
      // User might have blocked the bot or doesn't allow DMs
      logger.warn(`Could not send DM to user ${userId}:`, error.message);
    }
  }
  
  async handleNewMembers(bot, msg) {
    const chat = msg.chat;
    const newMembers = msg.new_chat_members;
    
    // Get or create group
    const group = await Group.findOrCreate(chat);
    
    for (const member of newMembers) {
      // Ignore bots
      if (member.is_bot) continue;
      
      // Save user
      await User.findOrCreate(member);
      
      // Log join
      await Log.log({
        type: 'USER_JOIN',
        groupId: chat.id,
        userId: member.id,
        action: 'user_joined',
        details: {
          username: member.username,
          firstName: member.first_name
        }
      });
      
      // Check if bot was added
      if (member.id === bot.id) {
        await this.handleBotAdded(bot, msg, group);
        continue;
      }
      
      // Send welcome message if enabled
      if (group.settings.welcomeNewMembers) {
        await this.sendWelcomeMessage(bot, msg, member, group);
      }
      
      // Apply restrictions for new members if enabled
      if (group.settings.restrictNewMembers) {
        await this.restrictNewMember(bot, chat.id, member.id, group);
      }
      
      // AI check for suspicious new members
      await this.checkNewMember(bot, msg, member, group);
    }
  }
  
  async handleBotAdded(bot, msg, group) {
    const chat = msg.chat;
    
    // Send introduction message
    const intro = `👋 Hello everyone! I'm Yuki, your AI moderation assistant.\n\n` +
      `I'll help keep this group safe and friendly with:\n` +
      `✅ AI-powered moderation\n` +
      `✅ Automatic rule enforcement\n` +
      `✅ Warning system\n` +
      `✅ Appeal process\n\n` +
      `Please make me an admin with necessary permissions for full functionality.\n` +
      `Use /help to see available commands.\n\n` +
      `Owner: @${process.env.TELEGRAM_OWNER_USERNAME || 'Unknown'}`;
    
    await bot.sendMessage(chat.id, intro);
    
    // Log bot addition
    await Log.log({
      type: 'SYSTEM',
      groupId: chat.id,
      action: 'bot_added',
      details: {
        addedBy: msg.from?.id,
        groupTitle: chat.title
      }
    });
  }
  
  async sendWelcomeMessage(bot, msg, member, group) {
    const chat = msg.chat;
    
    let welcomeText = group.welcomeMessage.text;
    
    if (!welcomeText || welcomeText.trim() === '') {
      // Generate AI welcome message
      welcomeText = await geminiService.generateWelcomeMessage(member, chat);
    }
    
    // Replace placeholders
    welcomeText = welcomeText
      .replace('{name}', member.first_name)
      .replace('{username}', member.username ? `@${member.username}` : member.first_name)
      .replace('{group}', chat.title);
    
    // Send welcome message
    await bot.sendMessage(chat.id, welcomeText, {
      parse_mode: 'HTML'
    });
  }
  
  async restrictNewMember(bot, chatId, userId, group) {
    const restrictionHours = group.settings.newMemberRestrictionHours;
    
    if (restrictionHours > 0) {
      await bot.restrictChatMember(chatId, userId, {
        until_date: Math.floor(Date.now() / 1000) + (restrictionHours * 3600),
        can_send_messages: true,
        can_send_media_messages: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_send_polls: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false
      });
    }
  }
  
  async checkNewMember(bot, msg, member, group) {
    // Check for suspicious patterns
    const suspiciousPatterns = [
      member.username && member.username.match(/^(spam|sale|buy|earn)/i),
      member.first_name.match(/[0-9]{10}/), // Phone number in name
      !member.username && member.first_name.length < 3
    ];
    
    if (suspiciousPatterns.some(pattern => pattern)) {
      // Send warning to admin
      const adminWarning = `⚠️ <b>Suspicious New Member</b>\n\n` +
        `User: ${member.first_name} (@${member.username || 'no_username'})\n` +
        `ID: ${member.id}\n` +
        `Joined: Just now\n\n` +
        `Patterns detected:\n` +
        `${suspiciousPatterns.map((p, i) => p ? `• Pattern ${i+1}` : '').filter(Boolean).join('\n')}`;
      
      // Send to log chat or group
      const logChatId = group.logs.logChatId || msg.chat.id;
      await bot.sendMessage(logChatId, adminWarning, { parse_mode: 'HTML' });
    }
  }
  
  async handleLeftMember(bot, msg) {
    const chat = msg.chat;
    const leftMember = msg.left_chat_member;
    
    if (!leftMember) return;
    
    // Log leave
    await Log.log({
      type: 'USER_LEAVE',
      groupId: chat.id,
      userId: leftMember.id,
      action: 'user_left',
      details: {
        username: leftMember.username,
        firstName: leftMember.first_name,
        isBot: leftMember.is_bot
      }
    });
    
    // Update user's join dates
    const user = await User.findOne({ userId: leftMember.id });
    if (user) {
      const joinRecord = user.joinDates.find(j => 
        j.groupId === chat.id && !j.leftDate
      );
      if (joinRecord) {
        joinRecord.leftDate = new Date();
        await user.save();
      }
    }
    
    // Send farewell message if enabled
    const group = await Group.findOne({ groupId: chat.id });
    if (group && group.settings.farewellMembers && !leftMember.is_bot) {
      let farewellText = group.farewellMessage.text;
      
      if (!farewellText || farewellText.trim() === '') {
        farewellText = `👋 Goodbye ${leftMember.first_name}! We'll miss you.`;
      }
      
      farewellText = farewellText
        .replace('{name}', leftMember.first_name)
        .replace('{username}', leftMember.username ? `@${leftMember.username}` : leftMember.first_name)
        .replace('{group}', chat.title);
      
      await bot.sendMessage(chat.id, farewellText, {
        parse_mode: 'HTML'
      });
    }
  }
  
  async handleChatMemberUpdate(bot, chatMember) {
    // Handle admin promotions/demotions
    const chat = chatMember.chat;
    const oldStatus = chatMember.old_chat_member.status;
    const newStatus = chatMember.new_chat_member.status;
    const user = chatMember.new_chat_member.user;
    
    // Get group
    const group = await Group.findOne({ groupId: chat.id });
    if (!group) return;
    
    // Check if user became admin
    if (oldStatus !== 'administrator' && newStatus === 'administrator') {
      // Add to group's admin list
      if (!group.isAdmin(user.id)) {
        await group.addAdmin(user, chatMember.from?.id, {
          canBan: true,
          canMute: true,
          canWarn: true,
          canDelete: true
        });
        
        // Log admin addition
        await Log.log({
          type: 'ADMIN_ACTION',
          groupId: chat.id,
          userId: user.id,
          action: 'admin_added',
          details: {
            addedBy: chatMember.from?.id,
            permissions: 'default'
          }
        });
      }
    }
    
    // Check if user was removed as admin
    if (oldStatus === 'administrator' && newStatus !== 'administrator') {
      // Remove from group's admin list
      await group.removeAdmin(user.id);
      
      // Log admin removal
      await Log.log({
        type: 'ADMIN_ACTION',
        groupId: chat.id,
        userId: user.id,
        action: 'admin_removed',
        details: {
          removedBy: chatMember.from?.id,
          newStatus: newStatus
        }
      });
    }
  }
  
  formatDuration(seconds) {
    if (seconds === 0) return 'permanent';
    
    const days = Math.floor(seconds / (24 * 3600));
    const hours = Math.floor((seconds % (24 * 3600)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.join(' ') || 'few seconds';
  }
}

module.exports = new ModerationHandler();

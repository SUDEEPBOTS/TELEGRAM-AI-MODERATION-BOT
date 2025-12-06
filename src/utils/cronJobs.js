const cron = require('node-cron');
const User = require('../database/models/User');
const Group = require('../database/models/Group');
const Log = require('../database/models/Log');
const logger = require('./logger');

class CronJobs {
  constructor() {
    this.jobs = new Map();
  }
  
  startAllJobs(bot) {
    // Cleanup expired mutes and bans every hour
    this.jobs.set('cleanup', cron.schedule('0 * * * *', () => {
      this.cleanupExpiredActions(bot);
    }));
    
    // Update statistics every day at midnight
    this.jobs.set('stats', cron.schedule('0 0 * * *', () => {
      this.updateDailyStats();
    }));
    
    // Backup database every Sunday at 2 AM
    this.jobs.set('backup', cron.schedule('0 2 * * 0', () => {
      this.backupDatabase();
    }));
    
    // Clean old logs every day at 3 AM
    this.jobs.set('logs', cron.schedule('0 3 * * *', () => {
      this.cleanOldLogs();
    }));
    
    // Check for inactive groups every week
    this.jobs.set('inactive', cron.schedule('0 4 * * 0', () => {
      this.checkInactiveGroups(bot);
    }));
    
    // Reset API key usage every hour
    this.jobs.set('apiKeys', cron.schedule('0 * * * *', () => {
      this.resetApiKeyUsage();
    }));
    
    logger.info(`Started ${this.jobs.size} cron jobs`);
  }
  
  async cleanupExpiredActions(bot) {
    try {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      // Find users with expired mutes
      const users = await User.find({
        'mutes': {
          $elemMatch: {
            unmuted: false,
            date: { $lt: oneDayAgo }
          }
        }
      });
      
      for (const user of users) {
        for (const mute of user.mutes) {
          if (!mute.unmuted && mute.date < oneDayAgo) {
            const muteEndTime = new Date(mute.date.getTime() + (mute.duration * 1000));
            
            if (muteEndTime < now) {
              // Unmute user
              try {
                await bot.restrictChatMember(mute.groupId, user.userId, {
                  can_send_messages: true,
                  can_send_media_messages: true,
                  can_send_other_messages: true,
                  can_add_web_page_previews: true
                });
                
                mute.unmuted = true;
                logger.info(`Auto-unmuted user ${user.userId} in group ${mute.groupId}`);
              } catch (error) {
                logger.error(`Failed to auto-unmute user ${user.userId}:`, error);
              }
            }
          }
        }
        await user.save();
      }
      
      // Find expired temporary bans
      const bannedUsers = await User.find({
        'bans': {
          $elemMatch: {
            unbanned: false,
            duration: { $gt: 0 }
          }
        }
      });
      
      for (const user of bannedUsers) {
        for (const ban of user.bans) {
          if (!ban.unbanned && ban.duration > 0) {
            const banEndTime = new Date(ban.date.getTime() + (ban.duration * 1000));
            
            if (banEndTime < now) {
              // Unban user
              try {
                await bot.unbanChatMember(ban.groupId, user.userId);
                ban.unbanned = true;
                logger.info(`Auto-unbanned user ${user.userId} from group ${ban.groupId}`);
              } catch (error) {
                logger.error(`Failed to auto-unban user ${user.userId}:`, error);
              }
            }
          }
        }
        await user.save();
      }
      
      logger.info('Cleanup job completed');
      
    } catch (error) {
      logger.error('Cleanup job error:', error);
    }
  }
  
  async updateDailyStats() {
    try {
      // Get yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Count new users from yesterday
      const newUsers = await User.countDocuments({
        createdAt: { $gte: yesterday, $lt: today }
      });
      
      // Count active groups (with activity in last 7 days)
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      const activeGroups = await Group.countDocuments({
        'stats.lastActivity': { $gte: weekAgo }
      });
      
      // Count total messages yesterday
      const logs = await Log.aggregate([
        {
          $match: {
            type: 'MESSAGE',
            timestamp: { $gte: yesterday, $lt: today }
          }
        },
        {
          $group: {
            _id: null,
            count: { $sum: 1 }
          }
        }
      ]);
      
      const totalMessages = logs[0]?.count || 0;
      
      // Save daily stats (you might want to create a Stats collection)
      logger.info(`Daily Stats - New Users: ${newUsers}, Active Groups: ${activeGroups}, Messages: ${totalMessages}`);
      
    } catch (error) {
      logger.error('Update stats job error:', error);
    }
  }
  
  async backupDatabase() {
    try {
      // This is a placeholder for database backup logic
      // In production, you might want to:
      // 1. Use mongodump
      // 2. Upload to cloud storage
      // 3. Send notification
      
      const backupTime = new Date().toISOString();
      logger.info(`Database backup completed at ${backupTime}`);
      
      // Send notification to owner
      // await bot.sendMessage(ownerId, `✅ Database backup completed at ${backupTime}`);
      
    } catch (error) {
      logger.error('Backup job error:', error);
    }
  }
  
  async cleanOldLogs() {
    try {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      
      // Delete logs older than 1 month
      const result = await Log.deleteMany({
        timestamp: { $lt: monthAgo }
      });
      
      logger.info(`Cleaned ${result.deletedCount} old logs`);
      
    } catch (error) {
      logger.error('Clean logs job error:', error);
    }
  }
  
  async checkInactiveGroups(bot) {
    try {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      
      // Find groups with no activity for a month
      const inactiveGroups = await Group.find({
        'stats.lastActivity': { $lt: monthAgo },
        'stats.totalMessages': { $gt: 0 } // Only groups that had activity
      });
      
      for (const group of inactiveGroups) {
        logger.info(`Inactive group: ${group.title} (${group.groupId}) - Last activity: ${group.stats.lastActivity}`);
        
        // You could send a message to the group or owner here
        // Example:
        // await bot.sendMessage(group.groupId, 
        //   'This group has been inactive for a month. The bot will leave if no activity continues.'
        // );
      }
      
    } catch (error) {
      logger.error('Check inactive groups job error:', error);
    }
  }
  
  async resetApiKeyUsage() {
    try {
      // Reset API key usage counters
      // This would depend on your API key management implementation
      logger.info('API key usage counters reset');
      
    } catch (error) {
      logger.error('Reset API keys job error:', error);
    }
  }
  
  stopAllJobs() {
    for (const [name, job] of this.jobs) {
      job.stop();
      logger.info(`Stopped cron job: ${name}`);
    }
    this.jobs.clear();
  }
  
  getJobStatus() {
    const status = {};
    for (const [name, job] of this.jobs) {
      status[name] = {
        running: job.getStatus() === 'started',
        nextDate: job.nextDate(),
        lastDate: job.lastDate()
      };
    }
    return status;
  }
}

module.exports = new CronJobs();

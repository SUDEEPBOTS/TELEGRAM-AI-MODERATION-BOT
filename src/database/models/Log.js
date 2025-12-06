const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'MESSAGE', 'COMMAND', 'MOD_ACTION', 'USER_JOIN', 
      'USER_LEAVE', 'SETTINGS_CHANGE', 'ERROR', 'APPEAL',
      'ADMIN_ACTION', 'SYSTEM'
    ],
    required: true
  },
  groupId: {
    type: Number,
    required: true
  },
  userId: {
    type: Number,
    default: null
  },
  targetUserId: {
    type: Number,
    default: null
  },
  action: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  messageId: {
    type: Number,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  }
});

// Indexes for efficient querying
logSchema.index({ groupId: 1, timestamp: -1 });
logSchema.index({ userId: 1, timestamp: -1 });
logSchema.index({ type: 1, timestamp: -1 });
logSchema.index({ 'details.command': 1 });

// Static methods
logSchema.statics.log = async function(data) {
  const log = new this(data);
  await log.save();
  
  // Keep only last 10,000 logs per group (optional cleanup)
  if (data.groupId) {
    const count = await this.countDocuments({ groupId: data.groupId });
    if (count > 10000) {
      const oldest = await this.findOne({ groupId: data.groupId })
        .sort({ timestamp: 1 })
        .select('_id');
      if (oldest) {
        await this.deleteOne({ _id: oldest._id });
      }
    }
  }
  
  return log;
};

logSchema.statics.getGroupLogs = async function(groupId, limit = 50, offset = 0) {
  return await this.find({ groupId })
    .sort({ timestamp: -1 })
    .skip(offset)
    .limit(limit)
    .lean();
};

logSchema.statics.getUserLogs = async function(userId, groupId = null, limit = 50) {
  const query = { userId };
  if (groupId) query.groupId = groupId;
  
  return await this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

logSchema.statics.searchLogs = async function(query, limit = 50) {
  return await this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

const Log = mongoose.model('Log', logSchema);

module.exports = Log;

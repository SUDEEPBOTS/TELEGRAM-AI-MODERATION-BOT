const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema({
  groupId: {
    type: Number,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: true
  },
  username: {
    type: String,
    default: null
  },
  type: {
    type: String,
    enum: ['group', 'supergroup', 'channel'],
    required: true
  },
  settings: {
    aiModeration: { type: Boolean, default: true },
    autoDeleteLinks: { type: Boolean, default: true },
    autoWarnSpam: { type: Boolean, default: true },
    welcomeNewMembers: { type: Boolean, default: true },
    farewellMembers: { type: Boolean, default: true },
    language: { type: String, default: 'en' },
    maxWarnings: { type: Number, default: 3 },
    muteDuration: { type: Number, default: 3600 }, // 1 hour
    banDuration: { type: Number, default: 0 }, // 0 = permanent
    restrictNewMembers: { type: Boolean, default: false },
    newMemberRestrictionHours: { type: Number, default: 24 }
  },
  rules: {
    text: { type: String, default: '' },
    lastUpdated: { type: Date, default: Date.now },
    updatedBy: Number
  },
  admins: [{
    userId: Number,
    username: String,
    firstName: String,
    addedBy: Number,
    addedDate: { type: Date, default: Date.now },
    canBan: { type: Boolean, default: true },
    canMute: { type: Boolean, default: true },
    canWarn: { type: Boolean, default: true },
    canDelete: { type: Boolean, default: true },
    canPin: { type: Boolean, default: false },
    canInvite: { type: Boolean, default: false }
  }],
  ignoredUsers: [{
    userId: Number,
    username: String,
    ignoredBy: Number,
    date: { type: Date, default: Date.now },
    reason: String
  }],
  blacklist: [{
    word: String,
    action: { type: String, enum: ['DELETE', 'WARN', 'MUTE', 'BAN'], default: 'DELETE' },
    addedBy: Number,
    date: { type: Date, default: Date.now }
  }],
  welcomeMessage: {
    text: { type: String, default: '' },
    enabled: { type: Boolean, default: true }
  },
  farewellMessage: {
    text: { type: String, default: '' },
    enabled: { type: Boolean, default: true }
  },
  logs: {
    enabled: { type: Boolean, default: true },
    logChatId: { type: Number, default: null }
  },
  stats: {
    totalMembers: { type: Number, default: 0 },
    totalMessages: { type: Number, default: 0 },
    totalBans: { type: Number, default: 0 },
    totalMutes: { type: Number, default: 0 },
    totalWarnings: { type: Number, default: 0 },
    lastActivity: { type: Date, default: Date.now }
  },
  botAdmin: {
    userId: Number,
    username: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp
groupSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
groupSchema.index({ groupId: 1 });
groupSchema.index({ username: 1 });
groupSchema.index({ 'admins.userId': 1 });
groupSchema.index({ 'ignoredUsers.userId': 1 });

// Static methods
groupSchema.statics.findOrCreate = async function(chatData) {
  let group = await this.findOne({ groupId: chatData.id });
  
  if (!group) {
    group = new this({
      groupId: chatData.id,
      title: chatData.title,
      username: chatData.username,
      type: chatData.type
    });
    await group.save();
  } else {
    // Update group info
    const updates = {};
    if (chatData.title !== group.title) updates.title = chatData.title;
    if (chatData.username !== group.username) updates.username = chatData.username;
    
    if (Object.keys(updates).length > 0) {
      await this.updateOne({ _id: group._id }, { $set: updates });
    }
  }
  
  return group;
};

groupSchema.methods.isAdmin = function(userId) {
  return this.admins.some(admin => admin.userId === userId);
};

groupSchema.methods.isIgnored = function(userId) {
  return this.ignoredUsers.some(user => user.userId === userId);
};

groupSchema.methods.addAdmin = async function(userData, addedBy, permissions = {}) {
  const adminExists = this.admins.some(a => a.userId === userData.id);
  
  if (!adminExists) {
    this.admins.push({
      userId: userData.id,
      username: userData.username,
      firstName: userData.first_name,
      addedBy,
      ...permissions
    });
    await this.save();
  }
};

groupSchema.methods.removeAdmin = async function(userId) {
  this.admins = this.admins.filter(admin => admin.userId !== userId);
  await this.save();
};

groupSchema.methods.addToBlacklist = async function(word, action, addedBy) {
  const exists = this.blacklist.some(item => item.word === word);
  
  if (!exists) {
    this.blacklist.push({
      word,
      action,
      addedBy
    });
    await this.save();
  }
};

groupSchema.methods.updateSettings = async function(settings) {
  this.settings = { ...this.settings, ...settings };
  await this.save();
};

const Group = mongoose.model('Group', groupSchema);

module.exports = Group;

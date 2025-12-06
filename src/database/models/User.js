const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: {
    type: Number,
    required: true,
    unique: true
  },
  username: {
    type: String,
    default: null
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    default: ''
  },
  languageCode: {
    type: String,
    default: 'en'
  },
  isBot: {
    type: Boolean,
    default: false
  },
  warnings: [{
    groupId: Number,
    reason: String,
    date: { type: Date, default: Date.now },
    warnedBy: Number
  }],
  bans: [{
    groupId: Number,
    reason: String,
    date: { type: Date, default: Date.now },
    bannedBy: Number,
    duration: Number, // in seconds, 0 = permanent
    unbanned: { type: Boolean, default: false }
  }],
  mutes: [{
    groupId: Number,
    reason: String,
    date: { type: Date, default: Date.now },
    mutedBy: Number,
    duration: Number, // in seconds
    unmuted: { type: Boolean, default: false }
  }],
  appeals: [{
    groupId: Number,
    appealText: String,
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ['PENDING', 'APPROVED', 'DENIED', 'OWNER_REVIEW'], default: 'PENDING' },
    reviewedBy: Number,
    reviewDate: Date,
    aiDecision: String,
    aiReason: String
  }],
  approvedUsers: [{
    groupId: Number,
    approvedBy: Number,
    date: { type: Date, default: Date.now },
    notes: String
  }],
  joinDates: [{
    groupId: Number,
    joinDate: { type: Date, default: Date.now },
    leftDate: Date
  }],
  stats: {
    messagesSent: { type: Number, default: 0 },
    commandsUsed: { type: Number, default: 0 },
    lastSeen: { type: Date, default: Date.now }
  },
  settings: {
    receiveDMs: { type: Boolean, default: true },
    language: { type: String, default: 'en' }
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

// Update timestamp on save
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes for faster queries
userSchema.index({ userId: 1 });
userSchema.index({ username: 1 });
userSchema.index({ 'warnings.groupId': 1 });
userSchema.index({ 'bans.groupId': 1 });
userSchema.index({ 'mutes.groupId': 1 });

// Static methods
userSchema.statics.findOrCreate = async function(userData) {
  let user = await this.findOne({ userId: userData.id });
  
  if (!user) {
    user = new this({
      userId: userData.id,
      username: userData.username,
      firstName: userData.first_name,
      lastName: userData.last_name || '',
      languageCode: userData.language_code || 'en',
      isBot: userData.is_bot || false
    });
    await user.save();
  } else {
    // Update user info if changed
    const updates = {};
    if (userData.username !== user.username) updates.username = userData.username;
    if (userData.first_name !== user.firstName) updates.firstName = userData.first_name;
    if (userData.last_name !== user.lastName) updates.lastName = userData.last_name;
    
    if (Object.keys(updates).length > 0) {
      await this.updateOne({ _id: user._id }, { $set: updates });
    }
  }
  
  return user;
};

userSchema.methods.getGroupWarnings = function(groupId) {
  return this.warnings.filter(w => w.groupId === groupId);
};

userSchema.methods.getGroupBans = function(groupId) {
  return this.bans.filter(b => b.groupId === groupId && !b.unbanned);
};

userSchema.methods.getActiveMute = function(groupId) {
  return this.mutes.find(m => 
    m.groupId === groupId && 
    !m.unmuted && 
    (Date.now() - new Date(m.date).getTime()) < m.duration * 1000
  );
};

userSchema.methods.addWarning = async function(groupId, reason, warnedBy) {
  this.warnings.push({
    groupId,
    reason,
    warnedBy
  });
  await this.save();
};

userSchema.methods.addBan = async function(groupId, reason, bannedBy, duration = 0) {
  this.bans.push({
    groupId,
    reason,
    bannedBy,
    duration
  });
  await this.save();
};

userSchema.methods.addMute = async function(groupId, reason, mutedBy, duration) {
  this.mutes.push({
    groupId,
    reason,
    mutedBy,
    duration
  });
  await this.save();
};

userSchema.methods.createAppeal = async function(groupId, appealText) {
  const appeal = {
    groupId,
    appealText,
    status: 'PENDING'
  };
  
  this.appeals.push(appeal);
  await this.save();
  return appeal;
};

const User = mongoose.model('User', userSchema);

module.exports = User;

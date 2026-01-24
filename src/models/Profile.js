const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const temporaryAssignmentSchema = new mongoose.Schema(
  {
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    reason: {
      type: String,
      default: 'Temporary assignment',
    },
  },
  { _id: true }
);

const profileSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Profile email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Profile password is required'],
      select: false, // Hidden from regular queries
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    state: {
      type: String,
      required: [true, 'State is required'],
      trim: true,
    },
    country: {
      type: String,
      required: [true, 'Country is required'],
      trim: true,
    },
    accountBearerName: {
      type: String,
      required: [true, 'Account bearer name is required'],
      trim: true,
    },
    defaultWorker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    temporaryAssignments: [temporaryAssignmentSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
    // Aggregated performance stats (updated periodically)
    totalTimeLogged: {
      type: Number,
      default: 0,
    },
    totalQualityScore: {
      type: Number,
      default: 0,
    },
    averageQuality: {
      type: Number,
      default: 0,
    },
    averageTime: {
      type: Number,
      default: 0,
    },
    overallPerformance: {
      type: Number,
      default: 0,
    },
    entryCount: {
      type: Number,
      default: 0,
    },
    // Admin vetted totals
    adminVettedTime: {
      type: Number,
      default: 0,
    },
    adminVettedQuality: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for ranking and searching
profileSchema.index({ overallPerformance: -1 });
profileSchema.index({ defaultWorker: 1 });
profileSchema.index({ email: 1 });

// Virtual to get current assigned worker (considering temporary assignments)
profileSchema.methods.getCurrentWorker = function () {
  const now = new Date();
  
  // Check for active temporary assignment
  const activeAssignment = this.temporaryAssignments.find(
    (assignment) =>
      assignment.startDate <= now && assignment.endDate >= now
  );
  
  if (activeAssignment) {
    return activeAssignment.worker;
  }
  
  return this.defaultWorker;
};

// Method to check if a worker is currently assigned to this profile
profileSchema.methods.isWorkerAssigned = function (workerId) {
  const currentWorker = this.getCurrentWorker();
  if (!currentWorker) return false;
  return currentWorker.toString() === workerId.toString();
};

// Hash password before saving (if modified)
profileSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Static method to update profile performance stats
profileSchema.statics.updatePerformanceStats = async function (profileId) {
  const Entry = require('./Entry');
  
  const stats = await Entry.aggregate([
    { $match: { profile: new mongoose.Types.ObjectId(profileId) } },
    {
      $group: {
        _id: '$profile',
        totalTime: { $sum: '$time' },
        totalQuality: { $sum: '$quality' },
        avgTime: { $avg: '$time' },
        avgQuality: { $avg: '$quality' },
        count: { $sum: 1 },
        adminTotalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        adminTotalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
      },
    },
  ]);

  if (stats.length > 0) {
    const stat = stats[0];
    // Overall performance: 60% quality + 40% time (normalized)
    const overallPerformance = (stat.avgQuality * 0.6) + (stat.avgTime * 0.4);
    
    await this.findByIdAndUpdate(profileId, {
      totalTimeLogged: stat.totalTime,
      totalQualityScore: stat.totalQuality,
      averageTime: Math.round(stat.avgTime * 100) / 100,
      averageQuality: Math.round(stat.avgQuality * 100) / 100,
      overallPerformance: Math.round(overallPerformance * 100) / 100,
      entryCount: stat.count,
      adminVettedTime: stat.adminTotalTime,
      adminVettedQuality: stat.adminTotalQuality,
    });
  }
};

module.exports = mongoose.model('Profile', profileSchema);

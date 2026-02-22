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
      select: false,
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
    /**
     * Primary assigned worker (slot 1).
     */
    defaultWorker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    /**
     * Secondary assigned worker (slot 2).
     * Spec: "Admin must be able to assign 1 or 2 users to each account."
     * Both workers operate concurrently — each submits their own entries.
     */
    secondWorker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    temporaryAssignments: [temporaryAssignmentSchema],
    isActive: {
      type: Boolean,
      default: true,
    },
    // Aggregated performance stats (recalculated on each entry save)
    totalTimeLogged: { type: Number, default: 0 },
    totalQualityScore: { type: Number, default: 0 },
    averageQuality: { type: Number, default: 0 },
    averageTime: { type: Number, default: 0 },
    overallPerformance: { type: Number, default: 0 },
    entryCount: { type: Number, default: 0 },
    adminVettedTime: { type: Number, default: 0 },
    adminVettedQuality: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

profileSchema.index({ overallPerformance: -1 });
profileSchema.index({ defaultWorker: 1 });
profileSchema.index({ secondWorker: 1 });
profileSchema.index({ email: 1 });

/**
 * Returns the effective worker(s) right now.
 * Temporary assignments take priority over permanent slots
 * for the worker in that slot only — both permanent workers
 * can still be active simultaneously.
 * Returns an array of worker ObjectIds currently assigned.
 */
profileSchema.methods.getActiveWorkers = function () {
  const now = new Date();
  const workers = new Set();

  // Add permanent workers
  if (this.defaultWorker) workers.add(this.defaultWorker.toString());
  if (this.secondWorker) workers.add(this.secondWorker.toString());

  // Add any active temporary assignments
  this.temporaryAssignments.forEach((a) => {
    if (a.startDate <= now && a.endDate >= now) {
      workers.add(a.worker.toString());
    }
  });

  return [...workers];
};

/**
 * Legacy single-value helper kept for backward compatibility
 * with code that only expects one worker.
 * Returns defaultWorker (or active temp assignment's worker if one exists).
 */
profileSchema.methods.getCurrentWorker = function () {
  const now = new Date();
  const activeAssignment = this.temporaryAssignments.find(
    (a) => a.startDate <= now && a.endDate >= now
  );
  if (activeAssignment) return activeAssignment.worker;
  return this.defaultWorker;
};

/**
 * Returns true if workerId is currently assigned (permanent or temporary).
 */
profileSchema.methods.isWorkerAssigned = function (workerId) {
  return this.getActiveWorkers().includes(workerId.toString());
};

// Hash password before saving
profileSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

/**
 * Recalculate and persist profile-level performance stats from all entries.
 * Called after every Entry save via Entry post-save hook.
 * IMPORTANT: Only counts adminApproved entries so stats reflect vetted work.
 */
profileSchema.statics.updatePerformanceStats = async function (profileId) {
  const Entry = require('./Entry');

  const stats = await Entry.aggregate([
    {
      $match: {
        profile: new mongoose.Types.ObjectId(profileId),
        adminApproved: true, // ← Only approved work affects profile stats
      },
    },
    {
      $group: {
        _id: '$profile',
        totalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        totalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
        avgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
        avgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
        count: { $sum: 1 },
        adminTotalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        adminTotalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
      },
    },
  ]);

  if (stats.length > 0) {
    const stat = stats[0];
    const overallPerformance = stat.avgQuality * 0.6 + stat.avgTime * 0.4;

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
const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema(
  {
    profile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'Profile is required'],
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Worker is required'],
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
    },
    // Worker entered values
    time: {
      type: Number,
      required: [true, 'Time is required'],
      min: [0, 'Time cannot be negative'],
      set: (v) => Math.round(v * 100) / 100, // 2 decimal places
    },
    quality: {
      type: Number,
      required: [true, 'Quality score is required'],
      min: [0, 'Quality cannot be negative'],
      max: [100, 'Quality cannot exceed 100'],
    },
    // Admin vetted values (optional)
    adminTime: {
      type: Number,
      min: [0, 'Admin time cannot be negative'],
      set: (v) => v ? Math.round(v * 100) / 100 : v,
    },
    adminQuality: {
      type: Number,
      min: [0, 'Admin quality cannot be negative'],
      max: [100, 'Admin quality cannot exceed 100'],
    },
    adminApproved: {
      type: Boolean,
      default: false,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    approvedAt: {
      type: Date,
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
    adminNotes: {
      type: String,
      maxlength: [500, 'Admin notes cannot exceed 500 characters'],
    },
    // Week tracking for aggregation
    weekNumber: {
      type: Number,
    },
    year: {
      type: Number,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound index for unique daily entry per profile per worker
entrySchema.index({ profile: 1, worker: 1, date: 1 }, { unique: true });
entrySchema.index({ worker: 1, date: -1 });
entrySchema.index({ profile: 1, date: -1 });
entrySchema.index({ weekNumber: 1, year: 1 });

// Calculate week number and year before saving
entrySchema.pre('save', function (next) {
  const date = new Date(this.date);
  this.year = date.getFullYear();
  
  // Calculate ISO week number
  const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
  const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
  this.weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  
  next();
});

// After save, update profile performance stats
entrySchema.post('save', async function () {
  const Profile = require('./Profile');
  await Profile.updatePerformanceStats(this.profile);
});

// Virtual for effective time (admin value if approved, else worker value)
entrySchema.virtual('effectiveTime').get(function () {
  return this.adminApproved && this.adminTime !== undefined
    ? this.adminTime
    : this.time;
});

// Virtual for effective quality (admin value if approved, else worker value)
entrySchema.virtual('effectiveQuality').get(function () {
  return this.adminApproved && this.adminQuality !== undefined
    ? this.adminQuality
    : this.quality;
});

// Virtual for time difference between worker and admin
entrySchema.virtual('timeDifference').get(function () {
  if (this.adminTime === undefined) return null;
  return Math.round((this.time - this.adminTime) * 100) / 100;
});

// Virtual for quality difference between worker and admin
entrySchema.virtual('qualityDifference').get(function () {
  if (this.adminQuality === undefined) return null;
  return Math.round((this.quality - this.adminQuality) * 100) / 100;
});

// Static method to get weekly summary for a worker
entrySchema.statics.getWeeklySummary = async function (workerId, weekNumber, year) {
  return this.aggregate([
    {
      $match: {
        worker: new mongoose.Types.ObjectId(workerId),
        weekNumber: weekNumber,
        year: year,
      },
    },
    {
      $group: {
        _id: { worker: '$worker', weekNumber: '$weekNumber', year: '$year' },
        totalTime: { $sum: '$time' },
        totalQuality: { $sum: '$quality' },
        avgTime: { $avg: '$time' },
        avgQuality: { $avg: '$quality' },
        adminTotalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        adminTotalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
        entries: { $sum: 1 },
        approvedEntries: {
          $sum: { $cond: ['$adminApproved', 1, 0] },
        },
      },
    },
  ]);
};

// Static method to get performance stats for all workers
entrySchema.statics.getWorkerPerformanceStats = async function (startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: '$worker',
        totalTime: { $sum: '$time' },
        totalQuality: { $sum: '$quality' },
        avgTime: { $avg: '$time' },
        avgQuality: { $avg: '$quality' },
        adminTotalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        adminTotalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
        entries: { $sum: 1 },
        profiles: { $addToSet: '$profile' },
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'workerInfo',
      },
    },
    {
      $unwind: '$workerInfo',
    },
    {
      $project: {
        worker: '$workerInfo',
        totalTime: 1,
        totalQuality: 1,
        avgTime: { $round: ['$avgTime', 2] },
        avgQuality: { $round: ['$avgQuality', 2] },
        adminTotalTime: 1,
        adminTotalQuality: 1,
        entries: 1,
        profileCount: { $size: '$profiles' },
        // Overall: 60% quality + 40% time
        overallPerformance: {
          $round: [
            { $add: [{ $multiply: ['$avgQuality', 0.6] }, { $multiply: ['$avgTime', 0.4] }] },
            2,
          ],
        },
      },
    },
    { $sort: { overallPerformance: -1 } },
  ]);
};

module.exports = mongoose.model('Entry', entrySchema);

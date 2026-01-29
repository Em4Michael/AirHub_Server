const mongoose = require('mongoose');

const weeklyPaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    weekStart: {
      type: Date,
      required: true,
    },
    weekEnd: {
      type: Date,
      required: true,
    },
    weekNumber: {
      type: Number,
      required: true,
    },
    year: {
      type: Number,
      required: true,
    },
    totalHours: {
      type: Number,
      default: 0,
      set: (v) => Math.round(v * 100) / 100,
    },
    avgQuality: {
      type: Number,
      default: 0,
      set: (v) => Math.round(v * 100) / 100,
    },
    entryCount: {
      type: Number,
      default: 0,
    },
    baseEarnings: {
      type: Number,
      default: 0,
    },
    performanceMultiplier: {
      type: Number,
      default: 1.0,
    },
    bonusEarnings: {
      type: Number,
      default: 0,
    },
    extraBonus: {
      type: Number,
      default: 0,
    },
    extraBonusReason: {
      type: String,
    },
    totalEarnings: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid'],
      default: 'pending',
    },
    paid: {
      type: Boolean,
      default: false,
    },
    paidDate: {
      type: Date,
    },
    paidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    notes: { type: String },
    adminNotes: { type: String },
  },
  { timestamps: true }
);

// Indexes
weeklyPaymentSchema.index({ user: 1, weekNumber: 1, year: 1 }, { unique: true });
weeklyPaymentSchema.index({ user: 1, weekStart: 1 });
weeklyPaymentSchema.index({ status: 1, paid: 1 });

// Always recalculate totalEarnings before save
weeklyPaymentSchema.pre('save', function (next) {
  this.totalEarnings =
    this.baseEarnings + this.bonusEarnings + (this.extraBonus || 0);
  next();
});

// Helpers
weeklyPaymentSchema.statics.getWeekBoundaries = function (date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0 = Sunday
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - day);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
};

weeklyPaymentSchema.statics.getWeekNumberAndYear = function (date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const firstDayOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const pastDays = Math.floor((d - firstDayOfYear) / 86400000);
  const dayOfWeekJan1 = firstDayOfYear.getUTCDay();
  const weekNumber = Math.ceil((pastDays + dayOfWeekJan1 + 1) / 7);
  return { weekNumber, year: d.getUTCFullYear() };
};

// Create or update weekly payment (benchmark is required)
weeklyPaymentSchema.statics.createOrUpdateWeeklyPayment = async function (
  userId,
  weekStart,
  weekEnd,
  weekNumber,
  year,
  stats,
  benchmark
) {
  const hourlyRate = parseInt(process.env.HOURLY_RATE) || 2000;

  const overallPerformance = (stats.avgQuality * 0.6) + (stats.avgTime * 0.4);

  let multiplier = 1.0;
  if (benchmark && benchmark.bonusRates) {
    const { thresholds, bonusRates } = benchmark;
    if (overallPerformance >= thresholds.excellent) multiplier = bonusRates.excellent;
    else if (overallPerformance >= thresholds.good) multiplier = bonusRates.good;
    else if (overallPerformance >= thresholds.average) multiplier = bonusRates.average;
    else if (overallPerformance >= thresholds.minimum) multiplier = bonusRates.minimum;
    else multiplier = bonusRates.below;
  }

  const baseEarnings = stats.totalHours * hourlyRate;
  const bonusEarnings = baseEarnings * (multiplier - 1);
  const totalEarnings = baseEarnings + bonusEarnings;

  const payment = await this.findOneAndUpdate(
    { user: userId, weekNumber, year },
    {
      user: userId,
      weekStart,
      weekEnd,
      weekNumber,
      year,
      totalHours: stats.totalHours,
      avgQuality: stats.avgQuality,
      entryCount: stats.entryCount,
      baseEarnings,
      performanceMultiplier: multiplier,
      bonusEarnings,
      totalEarnings,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return payment;
};

weeklyPaymentSchema.statics.getUserPayments = async function (userId, options = {}) {
  const { page = 1, limit = 20, status, paid } = options;

  const query = { user: userId };
  if (status) query.status = status;
  if (paid !== undefined) query.paid = paid;

  const payments = await this.find(query)
    .sort({ weekStart: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await this.countDocuments(query);

  return {
    payments,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
  };
};

module.exports = mongoose.model('WeeklyPayment', weeklyPaymentSchema);
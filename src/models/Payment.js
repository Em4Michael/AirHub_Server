const mongoose = require('mongoose');

const weeklyPaymentSchema = new mongoose.Schema(
  {
    user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    weekStart:    { type: Date,   required: true },
    weekEnd:      { type: Date,   required: true },
    weekNumber:   { type: Number, required: true },
    year:         { type: Number, required: true },
    weekStartDay: { type: Number, default: 2 },

    totalHours:  { type: Number, default: 0, set: (v) => Math.round(v * 100) / 100 },
    avgQuality:  { type: Number, default: 0, set: (v) => Math.round(v * 100) / 100 },
    entryCount:  { type: Number, default: 0 },
    hourlyRate:  { type: Number, default: 2000 },

    baseEarnings:          { type: Number, default: 0 },
    performanceMultiplier: { type: Number, default: 1.0 },
    bonusEarnings:         { type: Number, default: 0 },

    extraBonus:       { type: Number, default: 0 },
    extraBonusReason: { type: String },
    totalEarnings:    { type: Number, default: 0 },

    paymentType: {
      type: String, enum: ['regular', 'bonus'], default: 'regular',
    },
    status: {
      type: String, enum: ['pending', 'approved', 'paid', 'denied'], default: 'pending',
    },

    paid:     { type: Boolean, default: false },
    paidDate: { type: Date },
    paidBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    approvedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt:   { type: Date },
    deniedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deniedAt:     { type: Date },
    denialReason: { type: String },
    notes:        { type: String },
    adminNotes:   { type: String },
  },
  { timestamps: true }
);

// ── Indexes (NON-unique — performance only) ───────────────────────────────────
//
// IMPORTANT: If you previously had a UNIQUE index on { user, weekStart, paymentType },
// drop it once from the MongoDB shell so multiple bonuses per week can be saved:
//
//   db.weeklypayments.dropIndex({ user: 1, weekStart: 1, paymentType: 1 })
//
// The schema only creates a non-unique performance index below.
weeklyPaymentSchema.index({ user: 1, weekStart: 1, paymentType: 1 });
weeklyPaymentSchema.index({ user: 1, weekStart: -1 });
weeklyPaymentSchema.index({ status: 1, paid: 1 });
weeklyPaymentSchema.index({ paymentType: 1, status: 1 });

// Recompute totalEarnings on every save
weeklyPaymentSchema.pre('save', function (next) {
  if (this.paymentType === 'bonus') {
    this.totalEarnings = this.extraBonus || 0;
  } else {
    this.totalEarnings =
      (this.baseEarnings || 0) + (this.bonusEarnings || 0) + (this.extraBonus || 0);
  }
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

weeklyPaymentSchema.statics.getWeekBoundaries = function (date, weekStartDay = 2) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const daysBack  = (d.getUTCDay() - weekStartDay + 7) % 7;
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - daysBack);
  weekStart.setUTCHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);
  return { weekStart, weekEnd };
};

weeklyPaymentSchema.statics.getWeekNumberAndYear = function (date) {
  const d        = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const firstDay = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const pastDays = Math.floor((d - firstDay) / 86_400_000);
  const weekNumber = Math.ceil((pastDays + firstDay.getUTCDay() + 1) / 7);
  return { weekNumber, year: d.getUTCFullYear() };
};

weeklyPaymentSchema.statics.resolveHourlyRate = function (benchmark) {
  if (benchmark?.payPerHour > 0) return benchmark.payPerHour;
  return parseInt(process.env.HOURLY_RATE) || 2000;
};

// ── createOrUpdateWeeklyPayment ───────────────────────────────────────────────
// Upserts the regular weekly payment for a user/week, merging pending extraBonus.
weeklyPaymentSchema.statics.createOrUpdateWeeklyPayment = async function (
  userId, weekStart, weekEnd, weekNumber, year,
  stats, benchmark, weekStartDay = 2
) {
  const User       = mongoose.model('User');
  const hourlyRate = this.resolveHourlyRate(benchmark);
  const overallPerformance = (stats.avgQuality || 0) * 0.6 + (stats.avgTime || 0) * 0.4;

  let baseEarnings, bonusEarnings, multiplier, totalEarnings;

  if (benchmark && typeof benchmark.calculateEarnings === 'function') {
    const breakdown = benchmark.calculateEarnings(stats.totalHours, overallPerformance);
    baseEarnings  = breakdown.baseEarnings;
    bonusEarnings = breakdown.bonusEarnings;
    multiplier    = breakdown.multiplier;
    totalEarnings = breakdown.finalEarnings;
  } else {
    baseEarnings  = (stats.totalHours || 0) * hourlyRate;
    bonusEarnings = 0;
    multiplier    = 1.0;
    totalEarnings = baseEarnings;
  }

  // Merge pending user.extraBonus into this payment
  let extraBonus = 0, extraBonusReason = '';
  const owner = await User.findById(userId).select('extraBonus extraBonusReason');
  if (owner && Number(owner.extraBonus) > 0) {
    extraBonus       = Number(owner.extraBonus);
    extraBonusReason = owner.extraBonusReason || '';
    totalEarnings   += extraBonus;
    owner.extraBonus       = 0;
    owner.extraBonusReason = '';
    await owner.save();
    console.log(`[Payment] Merged bonus ₦${extraBonus} into week ${weekNumber}/${year} for user ${userId}`);
  }

  const payment = await this.findOneAndUpdate(
    { user: userId, weekStart, paymentType: 'regular' },
    {
      $set: {
        user: userId, weekStart, weekEnd, weekNumber, year, weekStartDay,
        paymentType: 'regular',
        totalHours:  stats.totalHours,
        avgQuality:  stats.avgQuality,
        entryCount:  stats.entryCount,
        hourlyRate, baseEarnings,
        performanceMultiplier: multiplier,
        bonusEarnings, extraBonus, extraBonusReason, totalEarnings,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return payment;
};

// ── createBonusPayment ────────────────────────────────────────────────────────
//
// Always creates a NEW bonus record so admins can assign multiple separate bonuses.
// Each bonus gets its own WeeklyPayment document with paymentType='bonus'.
//
// ⚠️  If you see a duplicate-key error here, MongoDB still has a legacy UNIQUE
//     index on { user, weekStart, paymentType }. Drop it once:
//
//       db.weeklypayments.dropIndex({ user: 1, weekStart: 1, paymentType: 1 })
//
//     The schema only declares this as a NON-unique performance index, so after
//     dropping the old one, multiple bonuses per user per week will work fine.
weeklyPaymentSchema.statics.createBonusPayment = async function (userId, amount, reason) {
  const now = new Date();
  const { weekStart, weekEnd } = this.getWeekBoundaries(now);
  const { weekNumber, year }   = this.getWeekNumberAndYear(weekStart);

  // Always insert a new document — do NOT accumulate into an existing record.
  // This allows admins to assign and track multiple distinct bonuses.
  const payment = await this.create({
    user: userId,
    weekStart,
    weekEnd,
    weekNumber,
    year,
    paymentType:      'bonus',
    totalHours:       0,
    avgQuality:       0,
    entryCount:       0,
    hourlyRate:       0,
    baseEarnings:     0,
    performanceMultiplier: 1,
    bonusEarnings:    0,
    extraBonus:       amount,
    extraBonusReason: reason,
    totalEarnings:    amount,
    status: 'pending',
    paid:   false,
  });

  return payment;
};

weeklyPaymentSchema.statics.getUserPayments = async function (userId, options = {}) {
  const { page = 1, limit = 20, status, paid } = options;
  const query = { user: userId };
  if (status)             query.status = status;
  if (paid !== undefined) query.paid   = paid;
  const payments = await this.find(query)
    .sort({ weekStart: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));
  const total = await this.countDocuments(query);
  return { payments, total, page: parseInt(page), pages: Math.ceil(total / limit) };
};

module.exports = mongoose.model('WeeklyPayment', weeklyPaymentSchema);
const mongoose = require('mongoose');

const benchmarkSchema = new mongoose.Schema(
  {
    timeBenchmark:    { type: Number, required: true, min: 0 },
    qualityBenchmark: { type: Number, required: true, min: 0, max: 100 },
    startDate: { type: Date, required: true },
    endDate:   { type: Date, required: true },

    /** Pay per hour — overrides HOURLY_RATE env var when set */
    payPerHour: { type: Number, default: null, min: 0 },

    // -------------------------------------------------------------------------
    // Earnings mode — controls how totalEarnings is calculated:
    //
    //  'flat'  — earnings = hours × rate  (no multiplier, score ignored)
    //  'score' — earnings = hours × rate × performanceMultiplier
    //            where multiplier comes from bonusRates[tier]
    //
    // Default: 'flat' so existing records are unaffected.
    // -------------------------------------------------------------------------
    earningsMode: {
      type: String,
      enum: ['flat', 'score'],
      default: 'flat',
    },

    thresholds: {
      excellent: { type: Number, default: 80 },
      good:      { type: Number, default: 70 },
      average:   { type: Number, default: 60 },
      minimum:   { type: Number, default: 50 },
    },

    bonusRates: {
      excellent: { type: Number, default: 1.2 },
      good:      { type: Number, default: 1.1 },
      average:   { type: Number, default: 1.0 },
      minimum:   { type: Number, default: 0.9 },
      below:     { type: Number, default: 0.8 },
    },

    notes:     { type: String },
    isActive:  { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Virtual — is this benchmark the currently active one?
// ---------------------------------------------------------------------------
benchmarkSchema.virtual('isCurrent').get(function () {
  const now = new Date();
  return this.isActive && this.startDate <= now && this.endDate >= now;
});

benchmarkSchema.set('toJSON', { virtuals: true });
benchmarkSchema.set('toObject', { virtuals: true });

// ---------------------------------------------------------------------------
// Static: get the benchmark whose date range covers today
// ---------------------------------------------------------------------------
benchmarkSchema.statics.getCurrentBenchmark = async function () {
  const now = new Date();
  return this.findOne({ isActive: true, startDate: { $lte: now }, endDate: { $gte: now } })
    .sort({ startDate: -1 })
    .exec();
};

// ---------------------------------------------------------------------------
// Static: get the most recently created benchmark (fallback)
// ---------------------------------------------------------------------------
benchmarkSchema.statics.getLatestBenchmark = async function () {
  return this.findOne({ isActive: true }).sort({ startDate: -1 }).exec();
};

// ---------------------------------------------------------------------------
// Instance: resolve the effective hourly rate
// ---------------------------------------------------------------------------
benchmarkSchema.methods.getHourlyRate = function () {
  if (this.payPerHour && this.payPerHour > 0) return this.payPerHour;
  return parseInt(process.env.HOURLY_RATE) || 2000;
};

// ---------------------------------------------------------------------------
// Instance: determine performance tier from an overall score (0-100)
// ---------------------------------------------------------------------------
benchmarkSchema.methods.getTier = function (overallScore) {
  const t = this.thresholds;
  if (overallScore >= t.excellent) return 'excellent';
  if (overallScore >= t.good)      return 'good';
  if (overallScore >= t.average)   return 'average';
  if (overallScore >= t.minimum)   return 'minimum';
  return 'below';
};

// ---------------------------------------------------------------------------
// Instance: calculate earnings for a given number of hours and performance score.
//
// earningsMode === 'flat'  → earnings = hours × rate
// earningsMode === 'score' → earnings = hours × rate × bonusRates[tier]
//
// Returns an object with all breakdown fields so controllers can store them.
// ---------------------------------------------------------------------------
benchmarkSchema.methods.calculateEarnings = function (hours, overallScore) {
  const hourlyRate = this.getHourlyRate();
  const baseEarnings = hours * hourlyRate;

  if (this.earningsMode === 'score') {
    const tier = this.getTier(overallScore);
    const multiplier = this.bonusRates[tier] || 1.0;
    const bonusEarnings = baseEarnings * (multiplier - 1);
    return {
      hourlyRate,
      baseEarnings,
      multiplier,
      bonusEarnings,
      tier,
      finalEarnings: baseEarnings * multiplier,
    };
  }

  // Default: 'flat' — no multiplier
  return {
    hourlyRate,
    baseEarnings,
    multiplier: 1.0,
    bonusEarnings: 0,
    tier: 'flat',
    finalEarnings: baseEarnings,
  };
};

module.exports = mongoose.model('Benchmark', benchmarkSchema);
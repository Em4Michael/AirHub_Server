const mongoose = require('mongoose');

const benchmarkSchema = new mongoose.Schema(
  {
    // Time benchmark (hours per day/week)
    timeBenchmark: {
      type: Number,
      required: [true, 'Time benchmark is required'],
      min: [0, 'Time benchmark cannot be negative'],
    },
    // Quality benchmark (score)
    qualityBenchmark: {
      type: Number,
      required: [true, 'Quality benchmark is required'],
      min: [0, 'Quality benchmark cannot be negative'],
      max: [100, 'Quality benchmark cannot exceed 100'],
    },
    // Start date of this benchmark period
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
    },
    // End date of this benchmark period
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
    },
    // Percentage thresholds for bonuses/badges
    thresholds: {
      excellent: { type: Number, default: 80 }, // 80% and above
      good: { type: Number, default: 70 },      // 70-79%
      average: { type: Number, default: 60 },   // 60-69%
      minimum: { type: Number, default: 50 },   // 50-59%
    },
    // Bonus rates per threshold (multiplier or fixed amount)
    bonusRates: {
      excellent: { type: Number, default: 1.2 },  // 20% bonus
      good: { type: Number, default: 1.1 },       // 10% bonus
      average: { type: Number, default: 1.0 },    // No bonus
      minimum: { type: Number, default: 0.9 },    // 10% reduction
      below: { type: Number, default: 0.8 },      // 20% reduction
    },
    // Who created this benchmark
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Status
    isActive: {
      type: Boolean,
      default: true,
    },
    notes: {
      type: String,
      maxlength: [500, 'Notes cannot exceed 500 characters'],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Index for finding active/current benchmark
benchmarkSchema.index({ startDate: -1, isActive: 1 });
benchmarkSchema.index({ startDate: 1, endDate: 1 });

// Virtual to check if benchmark is current
benchmarkSchema.virtual('isCurrent').get(function () {
  const now = new Date();
  return this.startDate <= now && this.endDate >= now && this.isActive;
});

// Static method to get current active benchmark
benchmarkSchema.statics.getCurrentBenchmark = async function () {
  const now = new Date();
  return this.findOne({
    startDate: { $lte: now },
    endDate: { $gte: now },
    isActive: true,
  }).sort({ startDate: -1 });
};

// Static method to get latest benchmark (even if not current)
benchmarkSchema.statics.getLatestBenchmark = async function () {
  return this.findOne({ isActive: true }).sort({ startDate: -1 });
};

// Method to calculate percentage score against benchmark
benchmarkSchema.methods.calculatePercentage = function (time, quality) {
  const timePercentage = this.timeBenchmark > 0 
    ? (time / this.timeBenchmark) * 100 
    : 100;
  const qualityPercentage = this.qualityBenchmark > 0 
    ? (quality / this.qualityBenchmark) * 100 
    : 100;
  
  // Overall: 60% quality + 40% time
  return {
    timePercentage: Math.round(timePercentage * 100) / 100,
    qualityPercentage: Math.round(qualityPercentage * 100) / 100,
    overallPercentage: Math.round((qualityPercentage * 0.6 + timePercentage * 0.4) * 100) / 100,
  };
};

// Method to get badge/tier based on percentage
benchmarkSchema.methods.getTier = function (percentage) {
  if (percentage >= this.thresholds.excellent) return 'excellent';
  if (percentage >= this.thresholds.good) return 'good';
  if (percentage >= this.thresholds.average) return 'average';
  if (percentage >= this.thresholds.minimum) return 'minimum';
  return 'below';
};

// Method to calculate earnings with bonus
benchmarkSchema.methods.calculateEarnings = function (hours, percentage, hourlyRate = 2000) {
  const tier = this.getTier(percentage);
  const multiplier = this.bonusRates[tier] || 1;
  const baseEarnings = hours * hourlyRate;
  const finalEarnings = baseEarnings * multiplier;
  
  return {
    baseEarnings: Math.round(baseEarnings * 100) / 100,
    multiplier,
    tier,
    bonus: Math.round((finalEarnings - baseEarnings) * 100) / 100,
    finalEarnings: Math.round(finalEarnings * 100) / 100,
  };
};

// Pre-save: Deactivate overlapping benchmarks
benchmarkSchema.pre('save', async function (next) {
  if (this.isNew && this.isActive) {
    // Deactivate any overlapping active benchmarks
    await this.constructor.updateMany(
      {
        _id: { $ne: this._id },
        isActive: true,
        $or: [
          { startDate: { $lte: this.endDate, $gte: this.startDate } },
          { endDate: { $lte: this.endDate, $gte: this.startDate } },
          { startDate: { $lte: this.startDate }, endDate: { $gte: this.endDate } },
        ],
      },
      { isActive: false }
    );
  }
  next();
});

module.exports = mongoose.model('Benchmark', benchmarkSchema);

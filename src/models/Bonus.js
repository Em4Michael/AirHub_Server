const mongoose = require('mongoose');

/**
 * Bonus model — stores extra bonuses assigned by superadmin.
 *
 * Kept separate from WeeklyPayment intentionally so:
 *  1. Each bonus gets its own unique _id (no duplicate-key collisions).
 *  2. Multiple bonuses can exist for the same user in the same week.
 *  3. markBonusPaid/markWeekAsPaid merges pending bonuses at pay time.
 */
const bonusSchema = new mongoose.Schema(
  {
    user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, trim: true },

    /** pending → queued, will be merged into next weekly payment
     *  merged  → already folded into a WeeklyPayment record
     *  reset   → cancelled/reset by admin
     */
    status: {
      type: String,
      enum: ['pending', 'merged', 'reset'],
      default: 'pending',
    },

    /** Set when status becomes 'merged' */
    mergedIntoPayment: { type: mongoose.Schema.Types.ObjectId, ref: 'WeeklyPayment', default: null },
    mergedAt:          { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

bonusSchema.index({ user: 1, status: 1 });
bonusSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Bonus', bonusSchema);
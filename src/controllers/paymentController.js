const WeeklyPayment = require('../models/Payment');
const Entry = require('../models/Entry');
const User = require('../models/User');
const Benchmark = require('../models/Benchmark');
const Bonus = require('../models/Bonus');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const mongoose = require('mongoose');

/**
 * @route   GET /api/admin/weekly-payments
 */
const getWeeklyPayments = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, userId, status, paid, year, weekNumber, paymentType } = req.query;

  const query = {};
  if (userId)             query.user        = userId;
  if (status)             query.status      = status;
  if (paid !== undefined) query.paid        = paid === 'true';
  if (year)               query.year        = parseInt(year);
  if (weekNumber)         query.weekNumber  = parseInt(weekNumber);
  if (paymentType)        query.paymentType = paymentType;

  const payments = await WeeklyPayment.find(query)
    .populate('user',       'name email phone')
    .populate('paidBy',     'name email')
    .populate('approvedBy', 'name email')
    .populate('deniedBy',   'name email')
    .sort({ weekStart: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await WeeklyPayment.countDocuments(query);

  res.json({ success: true, count: payments.length, total, page: parseInt(page), pages: Math.ceil(total / limit), data: payments });
});

/**
 * @route   GET /api/admin/users/:id/weekly-payments
 */
const getUserWeeklyPayments = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.params.id;
  const { page = 1, limit = 100, paymentType } = req.query;

  const user = await User.findById(userId);
  if (!user) throw new ApiError('User not found', 404);

  const query = { user: userId };
  if (paymentType) query.paymentType = paymentType;

  const payments = await WeeklyPayment.find(query)
    .sort({ weekStart: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  const total = await WeeklyPayment.countDocuments(query);

  res.json({ success: true, count: payments.length, total, page: parseInt(page), pages: Math.ceil(total / limit), data: payments });
});

/**
 * @route   PUT /api/admin/weekly-payments/:paymentId/approve
 */
const approvePayment = asyncHandler(async (req, res) => {
  const payment = await WeeklyPayment.findById(req.params.paymentId);
  if (!payment) throw new ApiError('Payment not found', 404);
  if (payment.status === 'paid')     throw new ApiError('Payment is already paid', 400);
  if (payment.status === 'approved') throw new ApiError('Payment is already approved', 400);

  payment.status       = 'approved';
  payment.approvedBy   = req.user._id;
  payment.approvedAt   = new Date();
  payment.deniedBy     = undefined;
  payment.deniedAt     = undefined;
  payment.denialReason = undefined;
  await payment.save();

  res.json({ success: true, message: 'Payment approved', data: payment });
});

/**
 * @route   PUT /api/admin/weekly-payments/:paymentId/deny
 */
const denyPayment = asyncHandler(async (req, res) => {
  const payment = await WeeklyPayment.findById(req.params.paymentId);
  if (!payment) throw new ApiError('Payment not found', 404);
  if (payment.status === 'paid') throw new ApiError('Cannot deny an already paid payment', 400);

  payment.status       = 'denied';
  payment.deniedBy     = req.user._id;
  payment.deniedAt     = new Date();
  payment.denialReason = req.body.reason || 'Denied by admin';
  payment.approvedBy   = undefined;
  payment.approvedAt   = undefined;
  await payment.save();

  res.json({ success: true, message: 'Payment denied', data: payment });
});

/**
 * @desc    Mark a specific week as paid.
 *          Merges ALL pending Bonus records for this user into the payment,
 *          then marks them as 'merged' in the Bonus collection.
 *          Also clears user.extraBonus.
 * @route   POST /api/admin/mark-week-paid
 */
const markWeekAsPaid = asyncHandler(async (req, res) => {
  const { userId, weekStart: weekStartStr } = req.body;
  if (!userId || !weekStartStr) throw new ApiError('userId and weekStart are required', 400);

  const user = await User.findById(userId);
  if (!user) throw new ApiError('User not found', 404);

  const weekStartDay = user.weekStartDay ?? 2;
  const { weekStart, weekEnd } = WeeklyPayment.getWeekBoundaries(new Date(weekStartStr), weekStartDay);
  const { weekNumber, year }   = WeeklyPayment.getWeekNumberAndYear(weekStart);

  // Collect all pending bonuses from Bonus collection
  const pendingBonuses = await Bonus.find({ user: userId, status: 'pending' });
  const extraBonus       = pendingBonuses.reduce((sum, b) => sum + b.amount, 0);
  const extraBonusReason = pendingBonuses.map((b) => b.reason).join('; ');

  let payment = await WeeklyPayment.findOne({ user: userId, weekStart, paymentType: 'regular' });

  if (!payment) {
    // Build from approved entries
    const agg = await Entry.aggregate([
      {
        $match: {
          worker:        new mongoose.Types.ObjectId(userId),
          date:          { $gte: weekStart, $lte: weekEnd },
          adminApproved: true,
        },
      },
      {
        $group: {
          _id:        null,
          totalHours: { $sum:  { $ifNull: ['$adminTime',    '$time']    } },
          avgQuality: { $avg:  { $ifNull: ['$adminQuality', '$quality'] } },
          entryCount: { $sum:  1 },
        },
      },
    ]);
    const s = agg[0] || { totalHours: 0, avgQuality: 0, entryCount: 0 };

    const benchmark  = (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());
    const hourlyRate = (benchmark && benchmark.payPerHour) || parseInt(process.env.HOURLY_RATE) || 2000;
    const baseEarnings = Math.round(s.totalHours * hourlyRate * 100) / 100;

    payment = new WeeklyPayment({
      user: userId, weekStart, weekEnd, weekNumber, year, weekStartDay,
      paymentType:  'regular',
      totalHours:   Math.round(s.totalHours * 100) / 100,
      avgQuality:   Math.round((s.avgQuality || 0) * 100) / 100,
      entryCount:   s.entryCount,
      hourlyRate,
      baseEarnings,
      extraBonus,
      extraBonusReason,
      totalEarnings: baseEarnings + extraBonus,
      status: 'pending',
      paid:   false,
    });
  } else if (extraBonus > 0) {
    payment.extraBonus       = extraBonus;
    payment.extraBonusReason = extraBonusReason;
    payment.totalEarnings    = (Number(payment.baseEarnings) || 0) + extraBonus;
  }

  payment.status   = 'paid';
  payment.paid     = true;
  payment.paidDate = new Date();
  payment.paidBy   = req.user._id;
  await payment.save();

  // Mark bonuses as merged
  if (pendingBonuses.length > 0) {
    await Bonus.updateMany(
      { _id: { $in: pendingBonuses.map((b) => b._id) } },
      { status: 'merged', mergedIntoPayment: payment._id, mergedAt: new Date() }
    );
    // Clear user.extraBonus
    await User.findByIdAndUpdate(userId, { $set: { extraBonus: 0, extraBonusReason: '' } });
  }

  res.json({ success: true, message: 'Week marked as paid', data: payment });
});

/**
 * @desc    Pay the pending bonus for a user.
 *
 *          Reads pending bonuses from the Bonus collection (not WeeklyPayment).
 *          No duplicate-key risk since we're only writing to WeeklyPayment once.
 *
 *          CASE A — an unpaid regular week exists:
 *            → merge all pending Bonus records into it, mark it paid.
 *
 *          CASE B — all regular weeks already paid:
 *            → leave bonuses in Bonus collection (status='pending').
 *              They auto-merge when markWeekAsPaid is next called.
 *            → return pending=true so frontend shows the right message.
 *
 * @route   POST /api/admin/users/:userId/mark-bonus-paid
 */
const markBonusPaid = asyncHandler(async (req, res) => {
  const userId = req.params.userId || req.params.id;

  const user = await User.findById(userId);
  if (!user) throw new ApiError('User not found', 404);

  // Read from Bonus collection — no WeeklyPayment index conflicts possible
  const pendingBonuses = await Bonus.find({ user: userId, status: 'pending' });
  if (pendingBonuses.length === 0) throw new ApiError('No pending bonuses for this user', 400);

  const totalBonus   = pendingBonuses.reduce((sum, b) => sum + b.amount, 0);
  const bonusReasons = pendingBonuses.map((b) => b.reason).join('; ');

  // ── Case A: merge into the most recent unpaid regular week ────────────────
  const unpaidWeek = await WeeklyPayment.findOne({
    user:        userId,
    paid:        { $ne: true },
    paymentType: 'regular',
  }).sort({ weekStart: -1 });

  if (unpaidWeek) {
    unpaidWeek.extraBonus       = (Number(unpaidWeek.extraBonus) || 0) + totalBonus;
    unpaidWeek.extraBonusReason = bonusReasons;
    unpaidWeek.totalEarnings    = (Number(unpaidWeek.baseEarnings) || 0) + unpaidWeek.extraBonus;
    unpaidWeek.status           = 'paid';
    unpaidWeek.paid             = true;
    unpaidWeek.paidDate         = new Date();
    unpaidWeek.paidBy           = req.user._id;
    unpaidWeek.deniedBy         = undefined;
    unpaidWeek.deniedAt         = undefined;
    unpaidWeek.denialReason     = undefined;
    await unpaidWeek.save();

    // Mark all pending bonuses as merged
    await Bonus.updateMany(
      { _id: { $in: pendingBonuses.map((b) => b._id) } },
      { status: 'merged', mergedIntoPayment: unpaidWeek._id, mergedAt: new Date() }
    );

    // Clear user.extraBonus
    await User.findByIdAndUpdate(userId, { $set: { extraBonus: 0, extraBonusReason: '' } });

    return res.json({
      success: true,
      pending: false,
      message: `Bonus ₦${totalBonus} paid — merged into Week ${unpaidWeek.weekNumber}, ${unpaidWeek.year}`,
      data:    unpaidWeek,
    });
  }

  // ── Case B: all weeks paid — bonuses stay pending until next pay run ───────
  return res.json({
    success: true,
    pending: true,
    message: `All weeks are currently paid. Bonus of ₦${totalBonus} is queued and will automatically be included in the next weekly payment.`,
    data: {
      pendingBonuses,
      totalBonus,
      bonusReasons,
      status: 'queued_for_next_week',
    },
  });
});

/**
 * @route   PUT /api/admin/weekly-payments/:paymentId
 */
const updateWeeklyPayment = asyncHandler(async (req, res) => {
  const payment = await WeeklyPayment.findById(req.params.paymentId);
  if (!payment) throw new ApiError('Payment not found', 404);

  const { status, extraBonus, extraBonusReason, notes } = req.body;
  if (status !== undefined)  payment.status           = status;
  if (extraBonusReason)      payment.extraBonusReason = extraBonusReason;
  if (notes !== undefined)   payment.adminNotes       = notes;

  if (extraBonus !== undefined) {
    payment.extraBonus    = Number(extraBonus);
    payment.totalEarnings = (Number(payment.baseEarnings) || 0) + Number(extraBonus);
  }

  await payment.save();
  res.json({ success: true, message: 'Payment updated', data: payment });
});

/**
 * @route   POST /api/admin/generate-weekly-payments
 */
const generateWeeklyPayments = asyncHandler(async (req, res) => {
  const { weekStart, weekEnd } = req.body;
  if (!weekStart || !weekEnd) throw new ApiError('weekStart and weekEnd are required', 400);

  const start = new Date(weekStart);
  const end   = new Date(weekEnd);
  const { weekNumber, year } = WeeklyPayment.getWeekNumberAndYear(start);

  const benchmark = (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

  const workers = await Entry.aggregate([
    { $match: { date: { $gte: start, $lte: end }, adminApproved: true } },
    { $group: { _id: '$worker' } },
  ]);

  const generated = [];
  for (const { _id: workerId } of workers) {
    const worker       = await User.findById(workerId).select('weekStartDay');
    const weekStartDay = worker ? (worker.weekStartDay ?? 2) : 2;

    const stats = await Entry.aggregate([
      { $match: { worker: workerId, date: { $gte: start, $lte: end }, adminApproved: true } },
      {
        $group: {
          _id: null,
          totalHours: { $sum:  { $ifNull: ['$adminTime', '$time'] } },
          avgQuality: { $avg:  { $ifNull: ['$adminQuality', '$quality'] } },
          entryCount: { $sum:  1 },
          avgTime:    { $avg:  { $ifNull: ['$adminTime', '$time'] } },
        },
      },
    ]);

    const s = stats[0] || { totalHours: 0, avgQuality: 0, entryCount: 0, avgTime: 0 };
    if (s.entryCount > 0) {
      const p = await WeeklyPayment.createOrUpdateWeeklyPayment(
        workerId, start, end, weekNumber, year, s, benchmark, weekStartDay
      );
      generated.push(p);
    }
  }

  res.json({ success: true, message: `Generated ${generated.length} payment records`, count: generated.length, data: generated });
});

module.exports = {
  getWeeklyPayments,
  getUserWeeklyPayments,
  approvePayment,
  denyPayment,
  markWeekAsPaid,
  markBonusPaid,
  updateWeeklyPayment,
  generateWeeklyPayments,
};
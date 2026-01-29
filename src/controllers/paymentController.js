const WeeklyPayment = require("../models/Payment");
const Entry = require("../models/Entry");
const User = require("../models/User");
const Benchmark = require("../models/Benchmark");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const mongoose = require("mongoose");

/**
 * @desc    Get all weekly payments (with filters)
 * @route   GET /api/admin/weekly-payments
 * @access  Private (Admin, Superadmin)
 */
const getWeeklyPayments = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    userId,
    status,
    paid,
    year,
    weekNumber,
  } = req.query;

  const query = {};
  if (userId) query.user = userId;
  if (status) query.status = status;
  if (paid !== undefined) query.paid = paid === "true";
  if (year) query.year = parseInt(year);
  if (weekNumber) query.weekNumber = parseInt(weekNumber);

  const payments = await WeeklyPayment.find(query)
    .populate("user", "name email")
    .populate("paidBy", "name email")
    .sort({ weekStart: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await WeeklyPayment.countDocuments(query);

  res.json({
    success: true,
    count: payments.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: payments,
  });
});

/**
 * @desc    Get specific user's weekly payments
 * @route   GET /api/admin/users/:userId/weekly-payments
 * @access  Private (Admin, Superadmin)
 */
const getUserWeeklyPayments = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);

  const result = await WeeklyPayment.getUserPayments(userId, { page, limit });

  res.json({
    success: true,
    count: result.payments.length,
    total: result.total,
    page: result.page,
    pages: result.pages,
    data: result.payments,
  });
});

/**
 * @desc    Mark a week as paid
 * @route   POST /api/admin/mark-week-paid
 * @access  Private (Admin, Superadmin)
 */
const markWeekAsPaid = asyncHandler(async (req, res) => {
  const { userId, weekStart, weekEnd, extraBonus, extraBonusReason, notes } = req.body;

  if (!userId || !weekStart || !weekEnd) {
    throw new ApiError('User ID, week start, and week end are required', 400);
  }

  const user = await User.findById(userId);
  if (!user) throw new ApiError('User not found', 404);

  // Normalize dates
  const { weekStart: normalizedStart, weekEnd: normalizedEnd } = WeeklyPayment.getWeekBoundaries(
    new Date(weekStart)
  );
  const { weekNumber, year } = WeeklyPayment.getWeekNumberAndYear(normalizedStart);

  let payment = await WeeklyPayment.findOne({ user: userId, weekNumber, year });

  if (!payment) {
    // Create from entries if not exists
    const stats = await Entry.aggregate([
      {
        $match: {
          worker: new mongoose.Types.ObjectId(userId),
          date: { $gte: normalizedStart, $lte: normalizedEnd },
          adminApproved: true,
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: { $ifNull: ['$adminTime', '$time'] } },
          avgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
          entryCount: { $sum: 1 },
          avgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
        },
      },
    ]);

    const weekStats = stats[0] || { totalHours: 0, avgQuality: 0, entryCount: 0, avgTime: 0 };

    const benchmark = await Benchmark.getCurrentBenchmark(); // ← benchmark is fetched here!

    payment = await WeeklyPayment.createOrUpdateWeeklyPayment(
      userId,
      normalizedStart,
      normalizedEnd,
      weekNumber,
      year,
      weekStats,
      benchmark
    );
  }

  // Mark as paid
  payment.status = 'paid';
  payment.paid = true;
  payment.paidDate = new Date();
  payment.paidBy = req.user._id;

  if (extraBonus !== undefined) {
    payment.extraBonus = extraBonus;
    payment.extraBonusReason = extraBonusReason || 'Admin bonus';
  }
  if (notes) payment.adminNotes = notes;

  await payment.save();

  res.json({
    success: true,
    message: 'Week marked as paid successfully',
    data: payment,
  });
});

/**
 * @desc    Update weekly payment details
 * @route   PUT /api/admin/weekly-payments/:paymentId
 * @access  Private (Admin, Superadmin)
 */
const updateWeeklyPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { status, extraBonus, extraBonusReason, notes } = req.body;

  const payment = await WeeklyPayment.findById(paymentId);
  if (!payment) throw new ApiError("Payment record not found", 404);

  if (status) payment.status = status;
  if (extraBonus !== undefined) {
    payment.extraBonus = extraBonus;
    if (extraBonusReason) payment.extraBonusReason = extraBonusReason;
  }
  if (notes !== undefined) payment.adminNotes = notes;

  await payment.save();

  res.json({
    success: true,
    message: "Payment updated successfully",
    data: payment,
  });
});

/**
 * @desc    Generate weekly payments for all users (utility)
 * @route   POST /api/admin/generate-weekly-payments
 * @access  Private (Admin, Superadmin)
 */
const generateWeeklyPayments = asyncHandler(async (req, res) => {
  const { weekStart, weekEnd } = req.body;

  if (!weekStart || !weekEnd) {
    throw new ApiError("Week start and end dates are required", 400);
  }

  const start = new Date(weekStart);
  const end = new Date(weekEnd);

  // Calculate week number and year
  const firstDayOfYear = new Date(start.getFullYear(), 0, 1);
  const pastDaysOfYear = (start - firstDayOfYear) / 86400000;
  const weekNumber = Math.ceil(
    (pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7,
  );
  const year = start.getFullYear();

  // Get current benchmark
  const benchmark = await Benchmark.getCurrentBenchmark();

  // Get all active workers with entries in this week
  const workers = await Entry.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    { $group: { _id: "$worker" } },
  ]);

  const generated = [];

  for (const { _id: workerId } of workers) {
    // Calculate stats for this worker
    const entries = await Entry.aggregate([
      {
        $match: {
          worker: workerId,
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$time" },
          avgQuality: { $avg: "$quality" },
          entryCount: { $sum: 1 },
          avgTime: { $avg: "$time" },
        },
      },
    ]);

    const stats = entries[0] || {
      totalHours: 0,
      avgQuality: 0,
      entryCount: 0,
      avgTime: 0,
    };

    if (stats.entryCount > 0) {
      const payment = await WeeklyPayment.createOrUpdateWeeklyPayment(
        workerId,
        start,
        end,
        weekNumber,
        year,
        stats,
        benchmark,
      );

      generated.push(payment);
    }
  }

  res.json({
    success: true,
    message: `Generated ${generated.length} weekly payment records`,
    count: generated.length,
    data: generated,
  });
});

module.exports = {
  getWeeklyPayments,
  getUserWeeklyPayments,
  markWeekAsPaid,
  updateWeeklyPayment,
  generateWeeklyPayments,
};

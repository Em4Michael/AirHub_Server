const User = require('../models/User');
const Benchmark = require('../models/Benchmark');
const WeeklyPayment = require('../models/Payment');
const Bonus = require('../models/Bonus');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

// ---------------------------------------------------------------------------
// User role management
// ---------------------------------------------------------------------------

const promoteToAdmin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);
  if (user.role === 'superadmin') throw new ApiError('Cannot change superadmin role', 400);
  user.role = 'admin';
  user.isApproved = true;
  await user.save();
  res.json({ success: true, message: 'User promoted to admin', data: user });
});

const demoteToUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);
  if (user.role === 'superadmin') throw new ApiError('Cannot demote superadmin', 400);
  user.role = 'user';
  await user.save();
  res.json({ success: true, message: 'User demoted to regular user', data: user });
});

const revokeAccess = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);
  if (user.role === 'superadmin') throw new ApiError('Cannot revoke superadmin access', 400);
  user.isActive = false;
  user.isApproved = false;
  await user.save();
  res.json({ success: true, message: 'User access revoked', data: user });
});

const restoreAccess = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);
  user.isActive = true;
  user.isApproved = true;
  await user.save();
  res.json({ success: true, message: 'User access restored', data: user });
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);
  if (user.role === 'superadmin') throw new ApiError('Cannot delete superadmin', 400);
  await User.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'User deleted successfully' });
});

const approveAllPending = asyncHandler(async (req, res) => {
  const result = await User.updateMany(
    { isApproved: false, role: 'user' },
    { isApproved: true }
  );
  res.json({
    success: true,
    message: `Approved ${result.modifiedCount} pending users`,
    data: { approvedCount: result.modifiedCount },
  });
});

// ---------------------------------------------------------------------------
// Benchmark management
// ---------------------------------------------------------------------------

const createBenchmark = asyncHandler(async (req, res) => {
  const {
    timeBenchmark, qualityBenchmark, startDate, endDate,
    payPerHour, thresholds, bonusRates, notes,
  } = req.body;

  const benchmark = await Benchmark.create({
    timeBenchmark,
    qualityBenchmark,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    payPerHour: payPerHour || null,
    thresholds: thresholds || { excellent: 80, good: 70, average: 60, minimum: 50 },
    bonusRates: bonusRates || { excellent: 1.2, good: 1.1, average: 1.0, minimum: 0.9, below: 0.8 },
    notes,
    createdBy: req.user._id,
    isActive: true,
  });

  res.status(201).json({ success: true, message: 'Benchmark created successfully', data: benchmark });
});

const getAllBenchmarks = asyncHandler(async (req, res) => {
  const benchmarks = await Benchmark.find()
    .populate('createdBy', 'name email')
    .sort({ startDate: -1 });
  res.json({ success: true, count: benchmarks.length, data: benchmarks });
});

const getCurrentBenchmark = asyncHandler(async (req, res) => {
  let benchmark = await Benchmark.getCurrentBenchmark();
  if (!benchmark) benchmark = await Benchmark.getLatestBenchmark();
  res.json({ success: true, data: benchmark || null, message: benchmark ? undefined : 'No benchmarks found' });
});

const updateBenchmark = asyncHandler(async (req, res) => {
  const benchmark = await Benchmark.findById(req.params.id);
  if (!benchmark) throw new ApiError('Benchmark not found', 404);
  const allowed = ['timeBenchmark', 'qualityBenchmark', 'startDate', 'endDate', 'payPerHour', 'thresholds', 'bonusRates', 'notes', 'isActive'];
  allowed.forEach((field) => { if (req.body[field] !== undefined) benchmark[field] = req.body[field]; });
  await benchmark.save();
  res.json({ success: true, message: 'Benchmark updated', data: benchmark });
});

const deleteBenchmark = asyncHandler(async (req, res) => {
  const benchmark = await Benchmark.findById(req.params.id);
  if (!benchmark) throw new ApiError('Benchmark not found', 404);
  await Benchmark.findByIdAndDelete(req.params.id);
  res.json({ success: true, message: 'Benchmark deleted' });
});

// ---------------------------------------------------------------------------
// Bonus management — uses separate Bonus model (no WeeklyPayment conflicts)
// ---------------------------------------------------------------------------

/**
 * @desc  Add an extra bonus to a user.
 *        Saves to the Bonus collection (separate model, unique _id per bonus).
 *        Also updates user.extraBonus for dashboard display.
 * @route PUT /api/superadmin/bonus/:id
 */
const addExtraBonus = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  if (!amount || amount <= 0) throw new ApiError('Bonus amount must be greater than 0', 400);
  if (!reason || !reason.trim()) throw new ApiError('Bonus reason is required', 400);

  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);

  // Save to Bonus model — each call creates a new document with its own _id
  const bonus = await Bonus.create({
    user:      user._id,
    amount:    Number(amount),
    reason:    reason.trim(),
    status:    'pending',
    createdBy: req.user._id,
  });

  // Update user.extraBonus for dashboard display
  user.extraBonus       = (Number(user.extraBonus) || 0) + Number(amount);
  user.extraBonusReason = reason.trim();
  await user.save();

  res.json({
    success: true,
    message: `Bonus of ₦${amount} added successfully. It will be included in the next payment run.`,
    data: { user, bonus },
  });
});

/**
 * @desc  Reset all pending bonuses for a user.
 *        Marks all pending Bonus records as 'reset' and clears user.extraBonus.
 * @route PUT /api/superadmin/bonus/:id/reset
 */
const resetExtraBonus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);

  // Mark all pending bonuses as reset
  await Bonus.updateMany(
    { user: user._id, status: 'pending' },
    { status: 'reset' }
  );

  user.extraBonus       = 0;
  user.extraBonusReason = '';
  await user.save();

  res.json({ success: true, message: 'All pending bonuses reset', data: user });
});

// ---------------------------------------------------------------------------
// System stats
// ---------------------------------------------------------------------------

const getSystemStats = asyncHandler(async (req, res) => {
  const [totalUsers, totalAdmins, activeBenchmarks, bonusTotalResult] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    Benchmark.countDocuments({ isActive: true }),
    Bonus.aggregate([
      { $match: { status: { $in: ['pending', 'merged'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  res.json({
    success: true,
    data: {
      totalUsers,
      totalAdmins,
      activeBenchmarks,
      totalBonuses: bonusTotalResult[0]?.total || 0,
    },
  });
});

module.exports = {
  promoteToAdmin,
  demoteToUser,
  revokeAccess,
  restoreAccess,
  deleteUser,
  approveAllPending,
  createBenchmark,
  getAllBenchmarks,
  getCurrentBenchmark,
  updateBenchmark,
  deleteBenchmark,
  addExtraBonus,
  resetExtraBonus,
  getSystemStats,
};
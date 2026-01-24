const User = require('../models/User');
const Profile = require('../models/Profile');
const Entry = require('../models/Entry');
const Benchmark = require('../models/Benchmark');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

/**
 * @desc    Promote user to admin
 * @route   PUT /api/superadmin/promote/:id
 * @access  Private (Superadmin)
 */
const promoteToAdmin = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  if (user.role === 'superadmin') {
    throw new ApiError('Cannot modify superadmin role', 400);
  }

  if (user.role === 'admin') {
    throw new ApiError('User is already an admin', 400);
  }

  user.role = 'admin';
  await user.save();

  res.json({
    success: true,
    message: 'User promoted to admin successfully',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

/**
 * @desc    Demote admin to user
 * @route   PUT /api/superadmin/demote/:id
 * @access  Private (Superadmin)
 */
const demoteToUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  if (user.role === 'superadmin') {
    throw new ApiError('Cannot modify superadmin role', 400);
  }

  if (user.role === 'user') {
    throw new ApiError('User is already a regular user', 400);
  }

  user.role = 'user';
  await user.save();

  res.json({
    success: true,
    message: 'Admin demoted to user successfully',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
});

/**
 * @desc    Revoke user access (temporary)
 * @route   PUT /api/superadmin/revoke/:id
 * @access  Private (Superadmin)
 */
const revokeAccess = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  if (user.role === 'superadmin') {
    throw new ApiError('Cannot revoke superadmin access', 400);
  }

  user.isActive = false;
  await user.save();

  res.json({
    success: true,
    message: 'User access revoked successfully',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
    },
  });
});

/**
 * @desc    Restore user access
 * @route   PUT /api/superadmin/restore/:id
 * @access  Private (Superadmin)
 */
const restoreAccess = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  user.isActive = true;
  await user.save();

  res.json({
    success: true,
    message: 'User access restored successfully',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
    },
  });
});

/**
 * @desc    Delete user permanently
 * @route   DELETE /api/superadmin/delete/:id
 * @access  Private (Superadmin)
 */
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  if (user.role === 'superadmin') {
    throw new ApiError('Cannot delete superadmin', 400);
  }

  // Remove user from assigned profiles
  await Profile.updateMany(
    { defaultWorker: user._id },
    { $set: { defaultWorker: null } }
  );

  // Remove user from temporary assignments
  await Profile.updateMany(
    {},
    { $pull: { temporaryAssignments: { worker: user._id } } }
  );

  // Optionally: Delete or reassign user's entries
  // For audit purposes, we keep entries but you could delete them
  // await Entry.deleteMany({ worker: user._id });

  await User.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: 'User deleted permanently',
  });
});

/**
 * @desc    Create new benchmark
 * @route   POST /api/superadmin/benchmark
 * @access  Private (Superadmin)
 */
const createBenchmark = asyncHandler(async (req, res) => {
  const {
    timeBenchmark,
    qualityBenchmark,
    startDate,
    endDate,
    thresholds,
    bonusRates,
    notes,
  } = req.body;

  const benchmark = await Benchmark.create({
    timeBenchmark,
    qualityBenchmark,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    thresholds: thresholds || {
      excellent: 80,
      good: 70,
      average: 60,
      minimum: 50,
    },
    bonusRates: bonusRates || {
      excellent: 1.2,
      good: 1.1,
      average: 1.0,
      minimum: 0.9,
      below: 0.8,
    },
    createdBy: req.user._id,
    notes,
  });

  res.status(201).json({
    success: true,
    message: 'Benchmark created successfully',
    data: benchmark,
  });
});

/**
 * @desc    Update existing benchmark
 * @route   PUT /api/superadmin/benchmark/:id
 * @access  Private (Superadmin)
 */
const updateBenchmark = asyncHandler(async (req, res) => {
  const benchmark = await Benchmark.findById(req.params.id);

  if (!benchmark) {
    throw new ApiError('Benchmark not found', 404);
  }

  const allowedUpdates = [
    'timeBenchmark', 'qualityBenchmark', 'startDate', 
    'endDate', 'thresholds', 'bonusRates', 'notes', 'isActive'
  ];

  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      benchmark[field] = req.body[field];
    }
  });

  await benchmark.save();

  res.json({
    success: true,
    message: 'Benchmark updated successfully',
    data: benchmark,
  });
});

/**
 * @desc    Get all benchmarks
 * @route   GET /api/superadmin/benchmarks
 * @access  Private (Superadmin)
 */
const getBenchmarks = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, active } = req.query;

  const query = {};
  if (active !== undefined) query.isActive = active === 'true';

  const benchmarks = await Benchmark.find(query)
    .populate('createdBy', 'name email')
    .sort({ startDate: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Benchmark.countDocuments(query);

  res.json({
    success: true,
    count: benchmarks.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: benchmarks,
  });
});

/**
 * @desc    Get current benchmark
 * @route   GET /api/superadmin/benchmark/current
 * @access  Private (Admin, Superadmin)
 */
const getCurrentBenchmark = asyncHandler(async (req, res) => {
  const benchmark = await Benchmark.getCurrentBenchmark();

  if (!benchmark) {
    // Return latest if no current benchmark
    const latestBenchmark = await Benchmark.getLatestBenchmark();
    if (!latestBenchmark) {
      throw new ApiError('No benchmark found', 404);
    }
    return res.json({
      success: true,
      message: 'No current benchmark, returning latest',
      data: latestBenchmark,
    });
  }

  res.json({
    success: true,
    data: benchmark,
  });
});

/**
 * @desc    Delete benchmark
 * @route   DELETE /api/superadmin/benchmark/:id
 * @access  Private (Superadmin)
 */
const deleteBenchmark = asyncHandler(async (req, res) => {
  const benchmark = await Benchmark.findById(req.params.id);

  if (!benchmark) {
    throw new ApiError('Benchmark not found', 404);
  }

  await Benchmark.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: 'Benchmark deleted successfully',
  });
});

/**
 * @desc    Add extra bonus to a user
 * @route   PUT /api/superadmin/bonus/:id
 * @access  Private (Superadmin)
 */
const addExtraBonus = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;

  if (amount === undefined || amount < 0) {
    throw new ApiError('Please provide a valid bonus amount', 400);
  }

  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  user.extraBonus = (user.extraBonus || 0) + amount;
  await user.save();

  // Log the bonus (you could create a separate bonus log model)
  console.log(`Bonus added: ${amount} to user ${user.email}. Reason: ${reason || 'Not specified'}`);

  res.json({
    success: true,
    message: `Bonus of ${amount} added successfully`,
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      extraBonus: user.extraBonus,
    },
  });
});

/**
 * @desc    Reset user's extra bonus
 * @route   PUT /api/superadmin/bonus/:id/reset
 * @access  Private (Superadmin)
 */
const resetExtraBonus = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  user.extraBonus = 0;
  await user.save();

  res.json({
    success: true,
    message: 'Extra bonus reset successfully',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      extraBonus: user.extraBonus,
    },
  });
});

/**
 * @desc    Get system statistics
 * @route   GET /api/superadmin/stats
 * @access  Private (Superadmin)
 */
const getSystemStats = asyncHandler(async (req, res) => {
  const [
    totalUsers,
    totalAdmins,
    totalWorkers,
    pendingUsers,
    activeUsers,
    totalProfiles,
    totalEntries,
    approvedEntries,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'admin' }),
    User.countDocuments({ role: 'user', isApproved: true }),
    User.countDocuments({ isApproved: false }),
    User.countDocuments({ isActive: true, isApproved: true }),
    Profile.countDocuments(),
    Entry.countDocuments(),
    Entry.countDocuments({ adminApproved: true }),
  ]);

  // Get recent activity
  const recentEntries = await Entry.find()
    .populate('worker', 'name email')
    .populate('profile', 'fullName')
    .sort({ createdAt: -1 })
    .limit(10);

  const currentBenchmark = await Benchmark.getCurrentBenchmark();

  res.json({
    success: true,
    data: {
      users: {
        total: totalUsers,
        admins: totalAdmins,
        workers: totalWorkers,
        pending: pendingUsers,
        active: activeUsers,
      },
      profiles: {
        total: totalProfiles,
      },
      entries: {
        total: totalEntries,
        approved: approvedEntries,
        pending: totalEntries - approvedEntries,
      },
      currentBenchmark,
      recentActivity: recentEntries,
    },
  });
});

/**
 * @desc    Approve all pending users
 * @route   PUT /api/superadmin/approve-all
 * @access  Private (Superadmin)
 */
const approveAllPendingUsers = asyncHandler(async (req, res) => {
  const result = await User.updateMany(
    { isApproved: false, role: 'user' },
    { isApproved: true }
  );

  res.json({
    success: true,
    message: `${result.modifiedCount} users approved`,
    data: { approvedCount: result.modifiedCount },
  });
});

module.exports = {
  promoteToAdmin,
  demoteToUser,
  revokeAccess,
  restoreAccess,
  deleteUser,
  createBenchmark,
  updateBenchmark,
  getBenchmarks,
  getCurrentBenchmark,
  deleteBenchmark,
  addExtraBonus,
  resetExtraBonus,
  getSystemStats,
  approveAllPendingUsers,
};

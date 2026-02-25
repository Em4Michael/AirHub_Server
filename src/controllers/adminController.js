const User = require('../models/User');
const Profile = require('../models/Profile');
const Entry = require('../models/Entry');
const Benchmark = require('../models/Benchmark');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const mongoose = require('mongoose');
const WeeklyPayment = require('../models/Payment');

// ---------------------------------------------------------------------------
// Earnings helper — delegates to benchmark.calculateEarnings() which respects
// earningsMode ('flat' = hours×rate, 'score' = hours×rate×multiplier).
// Falls back to flat rate if no benchmark is available.
// ---------------------------------------------------------------------------
const calculateEarnings = (hours, performanceScore, benchmark) => {
  if (benchmark && typeof benchmark.calculateEarnings === 'function') {
    return benchmark.calculateEarnings(hours, performanceScore).finalEarnings;
  }
  const hourlyRate = parseInt(process.env.HOURLY_RATE) || 2000;
  return hours * hourlyRate;
};

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

/**
 * @desc Approve user signup
 * @route PUT /api/admin/approve/:id
 */
const approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError('User not found', 404);
  if (user.isApproved) throw new ApiError('User is already approved', 400);

  user.isApproved = true;
  user.status = 'approved';
  await user.save();

  res.json({
    success: true,
    message: 'User approved successfully',
    data: { id: user._id, email: user.email, name: user.name, phone: user.phone, isApproved: user.isApproved },
  });
});

/**
 * @desc Get pending signups
 * @route GET /api/admin/pending-users
 */
const getPendingUsers = asyncHandler(async (req, res) => {
  // FIX (Issue 1): include phone in pending users list
  const users = await User.find({ isApproved: false, role: 'user' }).select('-bankDetails -password');
  res.json({ success: true, count: users.length, data: users });
});

/**
 * @desc Get all users (paginated)
 * @route GET /api/admin/users
 *
 * FIX: Removed .populate('assignedProfiles') — it caused a 500 when any
 *      assignedProfiles ObjectId pointed to a deleted Profile document.
 *      The users-list page only needs name/email/role/status/bankDetails,
 *      none of which require population. getUserById still populates for
 *      the individual user-details page where it IS needed.
 */
const getAllUsers = asyncHandler(async (req, res) => {
  try {
    const { page = 1, limit = 200, role, isApproved, search } = req.query;
    const query = {};

    if (role) query.role = role;
    if (isApproved !== undefined) query.isApproved = isApproved === 'true';
    if (search) {
      query.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const parsedLimit = Math.min(parseInt(limit) || 200, 500);
    const parsedPage  = parseInt(page) || 1;

    // STEP 1: try the absolute simplest possible query first
    const users = await User.find(query)
      .select('name email role status isApproved bankDetails phone extraBonus createdAt profilePhoto')
      .sort({ createdAt: -1 })
      .skip((parsedPage - 1) * parsedLimit)
      .limit(parsedLimit)
      .lean({ virtuals: false });   // explicitly disable virtuals

    const total = await User.countDocuments(query);

    const normalised = users.map((u) => ({
      ...u,
      status: u.status || (u.isApproved ? 'approved' : 'pending'),
    }));

    return res.json({
      success: true,
      count: normalised.length,
      total,
      page: parsedPage,
      pages: Math.ceil(total / parsedLimit),
      data: normalised,
      pagination: {
        page: parsedPage,
        pages: Math.ceil(total / parsedLimit),
        total,
        count: normalised.length,
      },
    });

  } catch (err) {
    // Log the FULL error so you can see it in Render logs
    console.error('[getAllUsers] CRASH:', err.name, err.message);
    console.error('[getAllUsers] STACK:', err.stack);

    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to load users',
      errorName: err.name,
    });
  }
});

/**
 * @desc Get single user by ID
 * @route GET /api/admin/users/:id
 * FIX (Issue 1): phone is included in response.
 */
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-password')
    .populate('assignedProfiles');
  if (!user) throw new ApiError('User not found', 404);
  res.json({ success: true, data: user });
});

// ---------------------------------------------------------------------------
// Profile management
// ---------------------------------------------------------------------------

/**
 * @desc Create new profile (client account)
 * @route POST /api/admin/profile
 */
const createProfile = asyncHandler(async (req, res) => {
  const {
    email,
    password,
    fullName,
    state,
    country,
    accountBearerName,
    defaultWorker,
    secondWorker,
  } = req.body;

  if (await Profile.findOne({ email })) {
    throw new ApiError('Profile with this email already exists', 400);
  }

  for (const [label, workerId] of [['defaultWorker', defaultWorker], ['secondWorker', secondWorker]]) {
    if (workerId) {
      const worker = await User.findById(workerId);
      if (!worker) throw new ApiError(`Worker (${label}) not found`, 404);
      if (worker.role !== 'user') throw new ApiError(`${label} must have role "user"`, 400);
    }
  }

  if (
    defaultWorker &&
    secondWorker &&
    defaultWorker.toString() === secondWorker.toString()
  ) {
    throw new ApiError('defaultWorker and secondWorker must be different users', 400);
  }

  const profilePassword = password || Math.random().toString(36).slice(-8) + 'A1!';

  const profile = await Profile.create({
    email,
    password: profilePassword,
    fullName,
    state,
    country,
    accountBearerName,
    defaultWorker: defaultWorker || null,
    secondWorker: secondWorker || null,
  });

  if (defaultWorker) {
    await User.findByIdAndUpdate(defaultWorker, { $addToSet: { assignedProfiles: profile._id } });
  }
  if (secondWorker) {
    await User.findByIdAndUpdate(secondWorker, { $addToSet: { assignedProfiles: profile._id } });
  }

  res.status(201).json({
    success: true,
    message: password ? 'Profile created successfully' : 'Profile created with auto-generated password',
    data: profile,
  });
});

/**
 * @desc Update existing profile
 * @route PUT /api/admin/profile/:id
 */
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (!profile) throw new ApiError('Profile not found', 404);

  const allowed = [
    'email', 'password', 'fullName', 'state', 'country',
    'accountBearerName', 'defaultWorker', 'secondWorker', 'isActive',
  ];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) profile[field] = req.body[field];
  });

  await profile.save();
  res.json({ success: true, message: 'Profile updated', data: profile });
});

/**
 * @desc Get all profiles (paginated, filterable)
 * @route GET /api/admin/profiles
 */
const getProfiles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sort = '-createdAt', search, workerId } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { accountBearerName: { $regex: search, $options: 'i' } },
    ];
  }
  if (workerId) {
    query.$or = [
      { defaultWorker: workerId },
      { secondWorker: workerId },
      { 'temporaryAssignments.worker': workerId },
    ];
  }

  const profiles = await Profile.find(query)
    .populate('defaultWorker', 'name email phone')
    .populate('secondWorker', 'name email phone')
    .populate('temporaryAssignments.worker', 'name email phone')
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Profile.countDocuments(query);

  res.json({
    success: true,
    count: profiles.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: profiles,
  });
});

/**
 * @desc Get single profile + entries
 * @route GET /api/admin/profile/:id
 */
const getProfileById = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id)
    .select('+password')
    .populate('defaultWorker', 'name email phone')
    .populate('secondWorker', 'name email phone')
    .populate('temporaryAssignments.worker', 'name email phone');

  if (!profile) throw new ApiError('Profile not found', 404);

  const entries = await Entry.find({ profile: req.params.id })
    .populate('worker', 'name email phone')
    .sort({ date: -1 })
    .limit(50);

  res.json({ success: true, data: { profile, entries } });
});

// ---------------------------------------------------------------------------
// Entry vetting
// ---------------------------------------------------------------------------

/**
 * @desc Vet / approve an entry and auto-create or update the weekly payment.
 * @route POST /api/admin/vet-entry
 */
const vetEntry = asyncHandler(async (req, res) => {
  const { entryId, adminTime, adminQuality, adminNotes } = req.body;

  const entry = await Entry.findById(entryId);
  if (!entry) throw new ApiError('Entry not found', 404);

  if (adminTime !== undefined) entry.adminTime = adminTime;
  if (adminQuality !== undefined) entry.adminQuality = adminQuality;
  if (adminNotes !== undefined) entry.adminNotes = adminNotes;

  entry.adminApproved = true;
  entry.approvedBy = req.user._id;
  entry.approvedAt = new Date();

  await entry.save();

  try {
    const worker = await User.findById(entry.worker).select('weekStartDay');
    const weekStartDay = worker ? (worker.weekStartDay ?? 2) : 2;

    const { weekStart, weekEnd } = WeeklyPayment.getWeekBoundaries(
      new Date(entry.date),
      weekStartDay
    );
    const { weekNumber, year } = WeeklyPayment.getWeekNumberAndYear(weekStart);

    const benchmark =
      (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

    const stats = await Entry.aggregate([
      {
        $match: {
          worker: entry.worker,
          date: { $gte: weekStart, $lte: weekEnd },
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

    await WeeklyPayment.createOrUpdateWeeklyPayment(
      entry.worker.toString(),
      weekStart,
      weekEnd,
      weekNumber,
      year,
      weekStats,
      benchmark,
      weekStartDay
    );
  } catch (err) {
    console.error('Failed to auto-generate weekly payment:', err);
  }

  res.json({ success: true, message: 'Entry vetted successfully', data: entry });
});

// ---------------------------------------------------------------------------
// Entry listing
// ---------------------------------------------------------------------------

/**
 * @desc Get entries (paginated, filtered)
 * @route GET /api/admin/entries
 */
const getEntries = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, approved, workerId, profileId, startDate, endDate } = req.query;
  const query = {};

  if (approved !== undefined) query.adminApproved = approved === 'true';
  if (workerId) query.worker = workerId;
  if (profileId) query.profile = profileId;
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await Entry.find(query)
    .populate('profile', 'fullName email')
    .populate('worker', 'name email phone')
    .populate('approvedBy', 'name email')
    .sort({ date: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await Entry.countDocuments(query);

  res.json({
    success: true,
    count: entries.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: entries,
  });
});

// ---------------------------------------------------------------------------
// Ranked profiles / worker performance
// ---------------------------------------------------------------------------

/**
 * @desc Get ranked workers by performance
 * @route GET /api/admin/ranked-profiles
 */
const getRankedProfiles = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const benchmark =
    (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

  const ranked = await Entry.aggregate([
    {
      $match: {
        date: { $gte: start, $lte: end },
        adminApproved: true,
      },
    },
    {
      $group: {
        _id: '$worker',
        totalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        totalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
        entryCount: { $sum: 1 },
        avgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
        avgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
      },
    },
    {
      $addFields: {
        overallScore: {
          $add: [
            { $multiply: ['$avgQuality', 0.6] },
            { $multiply: ['$avgTime', 0.4] },
          ],
        },
      },
    },
    { $sort: { overallScore: -1 } },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'worker',
      },
    },
    { $unwind: '$worker' },
    {
      $project: {
        _id: '$worker._id',
        name: '$worker.name',
        email: '$worker.email',
        phone: '$worker.phone',   // FIX (Issue 1): include phone
        totalTime: { $round: ['$totalTime', 2] },
        avgQuality: { $round: ['$avgQuality', 2] },
        avgTime: { $round: ['$avgTime', 2] },
        overallScore: { $round: ['$overallScore', 2] },
        entryCount: 1,
      },
    },
  ]);

  // FIX (Issues 3 & 4): use benchmark.calculateEarnings for correct multiplier
  const rankedWithEarnings = ranked.map((worker) => ({
    ...worker,
    weeklyEarnings: Math.round(calculateEarnings(worker.totalTime, worker.overallScore, benchmark)),
  }));

  res.json({
    success: true,
    count: rankedWithEarnings.length,
    dateRange: { start, end },
    data: rankedWithEarnings,
  });
});

// ---------------------------------------------------------------------------
// Worker assignment
// ---------------------------------------------------------------------------

/**
 * @desc Reassign worker (permanent or temporary)
 * @route PUT /api/admin/reassign
 */
const reassignWorker = asyncHandler(async (req, res) => {
  const {
    profileId,
    newWorkerId,
    startDate,
    endDate,
    reason,
    permanent = false,
    slot = 'default',
  } = req.body;

  const profile = await Profile.findById(profileId);
  if (!profile) throw new ApiError('Profile not found', 404);

  const newWorker = await User.findById(newWorkerId);
  if (!newWorker) throw new ApiError('Worker not found', 404);
  if (newWorker.role !== 'user') throw new ApiError('Only role "user" can be assigned', 400);

  if (permanent) {
    const workerField = slot === 'second' ? 'secondWorker' : 'defaultWorker';
    const oldWorkerId = profile[workerField];

    profile[workerField] = newWorkerId;
    await profile.save();

    if (oldWorkerId && oldWorkerId.toString() !== newWorkerId.toString()) {
      await User.findByIdAndUpdate(oldWorkerId, { $pull: { assignedProfiles: profileId } });
    }
    await User.findByIdAndUpdate(newWorkerId, { $addToSet: { assignedProfiles: profileId } });

    return res.json({ success: true, message: 'Permanent reassignment complete', data: profile });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end <= start) throw new ApiError('End date must be after start date', 400);

  profile.temporaryAssignments.push({
    worker: newWorkerId,
    startDate: start,
    endDate: end,
    reason: reason || 'Temporary assignment',
  });

  await profile.save();
  res.json({ success: true, message: 'Temporary reassignment added', data: profile });
});

/**
 * @desc Remove temporary assignment
 * @route DELETE /api/admin/reassign/:profileId/:assignmentId
 */
const removeTemporaryAssignment = asyncHandler(async (req, res) => {
  const { profileId, assignmentId } = req.params;
  const profile = await Profile.findById(profileId);
  if (!profile) throw new ApiError('Profile not found', 404);

  profile.temporaryAssignments = profile.temporaryAssignments.filter(
    (a) => a._id.toString() !== assignmentId
  );

  await profile.save();
  res.json({ success: true, message: 'Temporary assignment removed', data: profile });
});

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

/**
 * @desc Get aggregated admin dashboard statistics
 * @route GET /api/admin/worker-stats
 * FIX (Issues 3 & 4): Earnings use benchmark.calculateEarnings() with multiplier.
 */
const getWorkerStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const benchmark =
    (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

  const [
    totalUsers,
    totalProfiles,
    pendingEntries,
    pendingUsers,
    activeWorkersResult,
    weeklyStatsResult,
  ] = await Promise.all([
    User.countDocuments({ role: 'user' }),
    Profile.countDocuments(),
    Entry.countDocuments({ adminApproved: false }),
    User.countDocuments({ isApproved: false, role: 'user' }),
    Entry.aggregate([
      { $match: { date: { $gte: start, $lte: end }, adminApproved: true } },
      { $group: { _id: '$worker' } },
      { $count: 'count' },
    ]),
    Entry.aggregate([
      { $match: { date: { $gte: start, $lte: end }, adminApproved: true } },
      {
        $group: {
          _id: null,
          totalHours: { $sum: { $ifNull: ['$adminTime', '$time'] } },
          avgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
          totalEntries: { $sum: 1 },
          avgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
        },
      },
    ]),
  ]);

  const activeWorkers = activeWorkersResult[0]?.count || 0;
  const weeklyStats = weeklyStatsResult[0] || { totalHours: 0, avgQuality: 0, totalEntries: 0, avgTime: 0 };

  const overallPerformance = weeklyStats.avgQuality * 0.6 + (weeklyStats.avgTime || 0) * 0.4;
  const weeklyEarnings = calculateEarnings(weeklyStats.totalHours, overallPerformance, benchmark);

  const lifetimeStatsResult = await Entry.aggregate([
    { $match: { adminApproved: true } },
    {
      $group: {
        _id: null,
        totalHours: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        avgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
        totalEntries: { $sum: 1 },
        avgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
      },
    },
  ]);

  const lifetimeStats = lifetimeStatsResult[0] || { totalHours: 0, avgQuality: 0, totalEntries: 0, avgTime: 0 };
  const lifetimePerformance = lifetimeStats.avgQuality * 0.6 + (lifetimeStats.avgTime || 0) * 0.4;
  const lifetimeEarnings = calculateEarnings(lifetimeStats.totalHours, lifetimePerformance, benchmark);

  res.json({
    success: true,
    data: {
      totalUsers,
      totalProfiles,
      pendingEntries,
      pendingUsers,
      activeWorkers,
      totalHoursThisWeek: Math.round(weeklyStats.totalHours * 100) / 100,
      avgQualityThisWeek: Math.round(weeklyStats.avgQuality * 10) / 10,
      weeklyEarnings: Math.round(weeklyEarnings),
      lifetimeEarnings: Math.round(lifetimeEarnings),
    },
    benchmark: benchmark
      ? {
          timeBenchmark:    benchmark.timeBenchmark,
          qualityBenchmark: benchmark.qualityBenchmark,
          thresholds:       benchmark.thresholds,
        }
      : null,
    dateRange: { start, end },
  });
});

// ---------------------------------------------------------------------------
// Per-user stats
// ---------------------------------------------------------------------------

/**
 * @desc Get detailed performance stats for a specific user
 * @route GET /api/admin/users/:id/stats
 * FIX (Issue 1): phone returned in user object.
 * FIX (Issues 3 & 4): Earnings use benchmark.calculateEarnings() with multiplier.
 */
const getUserStats = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  const user = await User.findById(userId).select('-password');
  if (!user) throw new ApiError('User not found', 404);

  const now = new Date();
  const weekStartDay = user.weekStartDay ?? 2;

  const { weekStart, weekEnd } = WeeklyPayment.getWeekBoundaries(now, weekStartDay);

  const benchmark =
    (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

  const lifetimeStatsRaw = await Entry.aggregate([
    {
      $match: {
        worker: new mongoose.Types.ObjectId(userId),
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

  const weeklyStatsRaw = await Entry.aggregate([
    {
      $match: {
        worker: new mongoose.Types.ObjectId(userId),
        date: { $gte: weekStart, $lte: weekEnd },
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

  const lifetime = lifetimeStatsRaw[0] || { totalHours: 0, avgQuality: 0, entryCount: 0, avgTime: 0 };
  const weekly   = weeklyStatsRaw[0]   || { totalHours: 0, avgQuality: 0, entryCount: 0, avgTime: 0 };

  const lifetimePerformance = lifetime.avgQuality * 0.6 + lifetime.avgTime * 0.4;
  const weeklyPerformance   = weekly.avgQuality   * 0.6 + weekly.avgTime   * 0.4;

  const lifetimeEarnings = calculateEarnings(lifetime.totalHours, lifetimePerformance, benchmark);
  const weeklyEarnings   = calculateEarnings(weekly.totalHours,   weeklyPerformance,   benchmark);

  const payments = await WeeklyPayment.find({ user: userId }).sort({ weekStart: -1 }).limit(20).lean();

  res.json({
    success: true,
    data: {
      user: {
        id:          user._id,
        name:        user.name,
        email:       user.email,
        phone:       user.phone,   // FIX (Issue 1)
        role:        user.role,
        isApproved:  user.isApproved,
        weekStartDay,
        bankDetails: user.bankDetails,
      },
      currentWeekRange: { weekStart, weekEnd },
      lifetime: {
        totalHours:    Math.round(lifetime.totalHours * 100) / 100,
        avgQuality:    Math.round(lifetime.avgQuality * 100) / 100,
        entryCount:    lifetime.entryCount,
        totalEarnings: Math.round(lifetimeEarnings),
      },
      weekly: {
        totalHours:    Math.round(weekly.totalHours * 100) / 100,
        avgQuality:    Math.round(weekly.avgQuality * 100) / 100,
        entryCount:    weekly.entryCount,
        totalEarnings: Math.round(weeklyEarnings),
      },
      payments: payments.map((p) => ({
        id:               p._id,
        weekStart:        p.weekStart,
        weekEnd:          p.weekEnd,
        weekNumber:       p.weekNumber,
        year:             p.year,
        hours:            p.totalHours,
        quality:          p.avgQuality,
        earnings:         p.totalEarnings,
        paid:             p.paid,
        paidDate:         p.paidDate,
        status:           p.status,
        paymentType:      p.paymentType,   // FIX (Issue 6): expose type
        extraBonus:       p.extraBonus,
        extraBonusReason: p.extraBonusReason,
        notes:            p.adminNotes,
      })),
    },
  });
});

/**
 * @desc Get individual worker earnings breakdown
 * @route GET /api/admin/users/:id/earnings
 * FIX (Issues 3 & 4): Earnings use benchmark.calculateEarnings() with multiplier.
 */
const getUserEarnings = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const user = await User.findById(userId).select('-password');
  if (!user) throw new ApiError('User not found', 404);

  const now = new Date();
  const weekStartDay = user.weekStartDay ?? 2;
  const { weekStart, weekEnd } = WeeklyPayment.getWeekBoundaries(now, weekStartDay);

  const benchmark =
    (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

  const [weeklyData, lifetimeData] = await Promise.all([
    Entry.aggregate([
      {
        $match: {
          worker: new mongoose.Types.ObjectId(userId),
          date: { $gte: weekStart, $lte: weekEnd },
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
    ]),
    Entry.aggregate([
      {
        $match: {
          worker: new mongoose.Types.ObjectId(userId),
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
    ]),
  ]);

  const weekly   = weeklyData[0]   || { totalHours: 0, avgQuality: 0, entryCount: 0, avgTime: 0 };
  const lifetime = lifetimeData[0] || { totalHours: 0, avgQuality: 0, entryCount: 0, avgTime: 0 };

  const weeklyPerformance   = weekly.avgQuality   * 0.6 + weekly.avgTime   * 0.4;
  const lifetimePerformance = lifetime.avgQuality * 0.6 + lifetime.avgTime * 0.4;

  // Use benchmark.calculateEarnings so earningsMode is respected
  const weeklyBreakdown = benchmark
    ? benchmark.calculateEarnings(weekly.totalHours, weeklyPerformance)
    : { finalEarnings: weekly.totalHours * (parseInt(process.env.HOURLY_RATE) || 2000), multiplier: 1, tier: 'flat' };
  const lifetimeBreakdown = benchmark
    ? benchmark.calculateEarnings(lifetime.totalHours, lifetimePerformance)
    : { finalEarnings: lifetime.totalHours * (parseInt(process.env.HOURLY_RATE) || 2000), multiplier: 1, tier: 'flat' };

  res.json({
    success: true,
    data: {
      worker: { id: user._id, name: user.name, email: user.email, phone: user.phone },
      weekRange: { weekStart, weekEnd },
      weekly: {
        hours:       Math.round(weekly.totalHours * 100) / 100,
        quality:     Math.round(weekly.avgQuality * 100) / 100,
        entries:     weekly.entryCount,
        earnings:    Math.round(weeklyBreakdown.finalEarnings),
        multiplier:  weeklyBreakdown.multiplier,
        tier:        weeklyBreakdown.tier,
        performance: Math.round(weeklyPerformance * 100) / 100,
      },
      lifetime: {
        hours:       Math.round(lifetime.totalHours * 100) / 100,
        quality:     Math.round(lifetime.avgQuality * 100) / 100,
        entries:     lifetime.entryCount,
        earnings:    Math.round(lifetimeBreakdown.finalEarnings),
        multiplier:  lifetimeBreakdown.multiplier,
        tier:        lifetimeBreakdown.tier,
        performance: Math.round(lifetimePerformance * 100) / 100,
      },
    },
  });
});

module.exports = {
  approveUser,
  getPendingUsers,
  getAllUsers,
  getUserById,
  createProfile,
  updateProfile,
  getProfiles,
  getProfileById,
  getRankedProfiles,
  vetEntry,
  getEntries,
  reassignWorker,
  removeTemporaryAssignment,
  getWorkerStats,
  getUserStats,
  getUserEarnings,
};
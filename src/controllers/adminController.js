const User = require("../models/User");
const Profile = require("../models/Profile");
const Entry = require("../models/Entry");
const Benchmark = require("../models/Benchmark");
const { asyncHandler, ApiError } = require("../middleware/errorHandler");
const mongoose = require("mongoose");
const WeeklyPayment = require("../models/Payment");

// Constants
const HOURLY_RATE = 2000; // NGN per hour

/**
 * Calculate earnings based on time and performance
 */
const calculateEarnings = (time, performancePercentage, benchmark) => {
  let multiplier = 1.0;

  if (benchmark && benchmark.bonusRates) {
    const { thresholds, bonusRates } = benchmark;
    if (performancePercentage >= thresholds.excellent) {
      multiplier = bonusRates.excellent;
    } else if (performancePercentage >= thresholds.good) {
      multiplier = bonusRates.good;
    } else if (performancePercentage >= thresholds.average) {
      multiplier = bonusRates.average;
    } else if (performancePercentage >= thresholds.minimum) {
      multiplier = bonusRates.minimum;
    } else {
      multiplier = bonusRates.below;
    }
  }

  return time * HOURLY_RATE * multiplier;
};

/**
 * @desc Approve user signup
 * @route PUT /api/admin/approve/:id
 * @access Private (Admin, Superadmin)
 */
const approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new ApiError("User not found", 404);
  if (user.isApproved) throw new ApiError("User is already approved", 400);

  user.isApproved = true;
  user.status = "approved";
  await user.save();

  res.json({
    success: true,
    message: "User approved successfully",
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      isApproved: user.isApproved,
      status: user.status,
    },
  });
});

/**
 * @desc Get pending signups
 * @route GET /api/admin/pending-users
 * @access Private (Admin, Superadmin)
 */
const getPendingUsers = asyncHandler(async (req, res) => {
  const users = await User.find({ isApproved: false, role: "user" }).select(
    "-bankDetails",
  );
  res.json({ success: true, count: users.length, data: users });
});

/**
 * @desc Get all users (paginated)
 * @route GET /api/admin/users
 * @access Private (Admin, Superadmin)
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, isApproved, search } = req.query;
  const query = {};
  if (role) query.role = role;
  if (isApproved !== undefined) query.isApproved = isApproved === "true";
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const users = await User.find(query)
    .populate("assignedProfiles", "fullName email")
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(parseInt(limit));

  const total = await User.countDocuments(query);

  res.json({
    success: true,
    count: users.length,
    total,
    page: parseInt(page),
    pages: Math.ceil(total / limit),
    data: users,
  });
});

/**
 * @desc Get single user by ID
 * @route GET /api/admin/users/:id
 * @access Private (Admin, Superadmin)
 */
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate("assignedProfiles");
  if (!user) throw new ApiError("User not found", 404);

  res.json({ success: true, data: user });
});

/**
 * @desc Create new profile (client account)
 * @route POST /api/admin/profile
 * @access Private (Admin, Superadmin)
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
  } = req.body;

  if (await Profile.findOne({ email })) {
    throw new ApiError("Profile with this email already exists", 400);
  }

  if (defaultWorker) {
    const worker = await User.findById(defaultWorker);
    if (!worker) throw new ApiError("Worker not found", 404);
    if (worker.role !== "user")
      throw new ApiError("Can only assign user role workers", 400);
  }

  // Generate a random password if not provided
  const profilePassword =
    password || Math.random().toString(36).slice(-8) + "A1!";

  const profile = await Profile.create({
    email,
    password: profilePassword,
    fullName,
    state,
    country,
    accountBearerName,
    defaultWorker: defaultWorker || null,
  });

  if (defaultWorker) {
    await User.findByIdAndUpdate(defaultWorker, {
      $addToSet: { assignedProfiles: profile._id },
    });
  }

  res.status(201).json({
    success: true,
    message: password
      ? "Profile created successfully"
      : "Profile created successfully with auto-generated password",
    data: profile,
  });
});

/**
 * @desc Update existing profile
 * @route PUT /api/admin/profile/:id
 * @access Private (Admin, Superadmin)
 */
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);
  if (!profile) throw new ApiError("Profile not found", 404);

  const allowed = [
    "email",
    "password",
    "fullName",
    "state",
    "country",
    "accountBearerName",
    "defaultWorker",
    "isActive",
  ];
  allowed.forEach((field) => {
    if (req.body[field] !== undefined) profile[field] = req.body[field];
  });

  await profile.save();
  res.json({ success: true, message: "Profile updated", data: profile });
});

/**
 * @desc Get all profiles (paginated, filterable)
 * @route GET /api/admin/profiles
 * @access Private (Admin, Superadmin)
 */
const getProfiles = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    sort = "-createdAt",
    search,
    workerId,
  } = req.query;
  const query = {};

  if (search) {
    query.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { accountBearerName: { $regex: search, $options: "i" } },
    ];
  }
  if (workerId) {
    query.$or = [
      { defaultWorker: workerId },
      { "temporaryAssignments.worker": workerId },
    ];
  }

  const profiles = await Profile.find(query)
    .populate("defaultWorker", "name email")
    .populate("temporaryAssignments.worker", "name email")
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
 * @desc Get single profile + recent entries
 * @route GET /api/admin/profile/:id
 * @access Private (Admin, Superadmin)
 */
const getProfileById = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id)
    .select("+password")
    .populate("defaultWorker", "name email")
    .populate("temporaryAssignments.worker", "name email");

  if (!profile) throw new ApiError("Profile not found", 404);

  const entries = await Entry.find({ profile: req.params.id })
    .populate("worker", "name email")
    .sort({ date: -1 })
    .limit(50);

  res.json({ success: true, data: { profile, entries } });
});

/**
 * @desc Get ranked profiles / workers by performance
 * @route GET /api/admin/ranked-profiles
 * @access Private (Admin, Superadmin)
 */
const getRankedProfiles = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get current benchmark
  const benchmark = await Benchmark.getCurrentBenchmark();

  const ranked = await Entry.aggregate([
    { $match: { date: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: "$worker",
        totalTime: { $sum: "$time" },
        totalQuality: { $sum: "$quality" },
        entryCount: { $sum: 1 },
        avgQuality: { $avg: "$quality" },
        avgTime: { $avg: "$time" },
      },
    },
    {
      $addFields: {
        overallScore: {
          $add: [
            { $multiply: ["$avgQuality", 0.6] },
            { $multiply: ["$avgTime", 0.4] },
          ],
        },
      },
    },
    { $sort: { overallScore: -1 } },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "worker",
      },
    },
    { $unwind: "$worker" },
    {
      $project: {
        _id: "$worker._id",
        name: "$worker.name",
        email: "$worker.email",
        totalTime: { $round: ["$totalTime", 2] },
        avgQuality: { $round: ["$avgQuality", 2] },
        avgTime: { $round: ["$avgTime", 2] },
        overallScore: { $round: ["$overallScore", 2] },
        entryCount: 1,
      },
    },
  ]);

  // Calculate earnings for each worker
  const rankedWithEarnings = ranked.map((worker) => {
    const weeklyEarnings = calculateEarnings(
      worker.totalTime,
      worker.overallScore,
      benchmark,
    );

    return {
      ...worker,
      weeklyEarnings: Math.round(weeklyEarnings),
    };
  });

  res.json({
    success: true,
    count: rankedWithEarnings.length,
    dateRange: { start, end },
    data: rankedWithEarnings,
  });
});

function getWeekBoundaries(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const weekStart = new Date(d);
  weekStart.setUTCDate(d.getUTCDate() - day);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  weekEnd.setUTCHours(23, 59, 59, 999);

  return { weekStart, weekEnd };
}

function getWeekNumberAndYear(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const firstDayOfYear = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const pastDays = Math.floor((d - firstDayOfYear) / 86400000);
  const dayOfWeekJan1 = firstDayOfYear.getUTCDay();
  const weekNumber = Math.ceil((pastDays + dayOfWeekJan1 + 1) / 7);
  return { weekNumber, year: d.getUTCFullYear() };
}

/**
 * @desc Vet / approve an entry + auto-create/update weekly payment
 */
const vetEntry = asyncHandler(async (req, res) => {
  const { entryId, adminTime, adminQuality, adminNotes } = req.body;
  const entry = await Entry.findById(entryId);
  if (!entry) throw new ApiError('Entry not found', 404);

  if (adminTime !== undefined) entry.adminTime = adminTime;
  if (adminQuality !== undefined) entry.adminQuality = adminQuality;
  if (adminNotes !== undefined) entry.adminNotes = adminNotes;

  entry.adminApproved = true;
  entry.adminApprovedBy = req.user._id;
  entry.adminApprovedAt = new Date();

  await entry.save();

  // Auto-create/update weekly payment
  try {
    const entryDate = new Date(entry.date);
    const { weekStart, weekEnd } = getWeekBoundaries(entryDate);
    const { weekNumber, year } = getWeekNumberAndYear(weekStart);

    const benchmark = await Benchmark.getCurrentBenchmark();

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

    const weekStats = stats[0] || {
      totalHours: 0,
      avgQuality: 0,
      entryCount: 0,
      avgTime: 0,
    };

    await WeeklyPayment.createOrUpdateWeeklyPayment(
      entry.worker.toString(),
      weekStart,
      weekEnd,
      weekNumber,
      year,
      weekStats,
      benchmark // ← benchmark is passed here!
    );
  } catch (err) {
    console.error('Failed to auto-generate weekly payment:', err);
    // Don't fail the vetting process
  }

  res.json({ success: true, message: 'Entry vetted successfully', data: entry });
});

/**
 * @desc Get entries (paginated, filtered)
 * @route GET /api/admin/entries
 * @access Private (Admin, Superadmin)
 */
const getEntries = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 50,
    approved,
    workerId,
    profileId,
    startDate,
    endDate,
  } = req.query;
  const query = {};

  if (approved !== undefined) query.adminApproved = approved === "true";
  if (workerId) query.worker = workerId;
  if (profileId) query.profile = profileId;
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }

  const entries = await Entry.find(query)
    .populate("profile", "fullName email")
    .populate("worker", "name email")
    .populate("approvedBy", "name email")
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

/**
 * @desc Reassign worker (permanent or temporary)
 * @route PUT /api/admin/reassign
 * @access Private (Admin, Superadmin)
 */
const reassignWorker = asyncHandler(async (req, res) => {
  const {
    profileId,
    newWorkerId,
    startDate,
    endDate,
    reason,
    permanent = false,
  } = req.body;

  const profile = await Profile.findById(profileId);
  if (!profile) throw new ApiError("Profile not found", 404);

  const newWorker = await User.findById(newWorkerId);
  if (!newWorker) throw new ApiError("Worker not found", 404);
  if (newWorker.role !== "user")
    throw new ApiError("Only user role can be assigned", 400);

  if (permanent) {
    const oldWorkerId = profile.defaultWorker;
    profile.defaultWorker = newWorkerId;
    await profile.save();

    if (oldWorkerId) {
      await User.findByIdAndUpdate(oldWorkerId, {
        $pull: { assignedProfiles: profileId },
      });
    }
    await User.findByIdAndUpdate(newWorkerId, {
      $addToSet: { assignedProfiles: profileId },
    });

    return res.json({
      success: true,
      message: "Permanent reassignment complete",
      data: profile,
    });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (end <= start)
    throw new ApiError("End date must be after start date", 400);

  profile.temporaryAssignments.push({
    worker: newWorkerId,
    startDate: start,
    endDate: end,
    reason: reason || "Temporary assignment",
  });

  await profile.save();
  res.json({
    success: true,
    message: "Temporary reassignment added",
    data: profile,
  });
});

/**
 * @desc Remove temporary assignment
 * @route DELETE /api/admin/reassign/:profileId/:assignmentId
 * @access Private (Admin, Superadmin)
 */
const removeTemporaryAssignment = asyncHandler(async (req, res) => {
  const { profileId, assignmentId } = req.params;
  const profile = await Profile.findById(profileId);
  if (!profile) throw new ApiError("Profile not found", 404);

  profile.temporaryAssignments = profile.temporaryAssignments.filter(
    (a) => a._id.toString() !== assignmentId,
  );

  await profile.save();
  res.json({
    success: true,
    message: "Temporary assignment removed",
    data: profile,
  });
});

/**
 * @desc Get aggregated worker statistics (for admin dashboard)
 * @route GET /api/admin/worker-stats
 * @access Private (Admin, Superadmin)
 */
const getWorkerStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Get current benchmark
  const benchmark = await Benchmark.getCurrentBenchmark();

  const [
    totalUsers,
    totalProfiles,
    pendingEntries,
    pendingUsers,
    activeWorkersResult,
    weeklyStatsResult,
  ] = await Promise.all([
    User.countDocuments({ role: "user" }),
    Profile.countDocuments(),
    Entry.countDocuments({ adminApproved: false }),
    User.countDocuments({ isApproved: false, role: "user" }),
    Entry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      { $group: { _id: "$worker" } },
      { $count: "count" },
    ]),
    Entry.aggregate([
      { $match: { date: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$time" },
          avgQuality: { $avg: "$quality" },
          totalEntries: { $sum: 1 },
        },
      },
    ]),
  ]);

  const activeWorkers = activeWorkersResult[0]?.count || 0;
  const weeklyStats = weeklyStatsResult[0] || {
    totalHours: 0,
    avgQuality: 0,
    totalEntries: 0,
  };

  // Calculate weekly earnings
  const overallPerformance =
    weeklyStats.avgQuality * 0.6 +
    (weeklyStats.totalHours / weeklyStats.totalEntries || 0) * 0.4;
  const weeklyEarnings = calculateEarnings(
    weeklyStats.totalHours,
    overallPerformance,
    benchmark,
  );

  // Get lifetime stats
  const lifetimeStatsResult = await Entry.aggregate([
    {
      $group: {
        _id: null,
        totalHours: { $sum: "$time" },
        avgQuality: { $avg: "$quality" },
        totalEntries: { $sum: 1 },
      },
    },
  ]);

  const lifetimeStats = lifetimeStatsResult[0] || {
    totalHours: 0,
    avgQuality: 0,
    totalEntries: 0,
  };
  const lifetimePerformance =
    lifetimeStats.avgQuality * 0.6 +
    (lifetimeStats.totalHours / lifetimeStats.totalEntries || 0) * 0.4;
  const lifetimeEarnings = calculateEarnings(
    lifetimeStats.totalHours,
    lifetimePerformance,
    benchmark,
  );

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
          timeBenchmark: benchmark.timeBenchmark,
          qualityBenchmark: benchmark.qualityBenchmark,
          thresholds: benchmark.thresholds,
        }
      : null,
    dateRange: { start, end },
  });
});

/**
 * @desc Get detailed performance stats for a specific user (weekly + lifetime + payments)
 * @route GET /api/admin/users/:id/stats
 * @access Private (Admin, Superadmin)
 */
const getUserStats = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  const user = await User.findById(userId).select("+bankDetails");
  if (!user) throw new ApiError("User not found", 404);

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get current benchmark
  const benchmark = await Benchmark.getCurrentBenchmark();

  // Lifetime stats
  const lifetimeStats = await Entry.aggregate([
    { $match: { worker: new mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalHours: { $sum: "$time" },
        totalQualitySum: { $sum: "$quality" },
        entryCount: { $sum: 1 },
        avgQuality: { $avg: "$quality" },
      },
    },
  ]);

  // Weekly stats
  const weeklyStats = await Entry.aggregate([
    {
      $match: {
        worker: new mongoose.Types.ObjectId(userId),
        date: { $gte: oneWeekAgo },
      },
    },
    {
      $group: {
        _id: null,
        totalHours: { $sum: "$time" },
        totalQualitySum: { $sum: "$quality" },
        entryCount: { $sum: 1 },
        avgQuality: { $avg: "$quality" },
      },
    },
  ]);

  const lifetime = lifetimeStats[0] || {
    totalHours: 0,
    avgQuality: 0,
    entryCount: 0,
  };
  const weekly = weeklyStats[0] || {
    totalHours: 0,
    avgQuality: 0,
    entryCount: 0,
  };

  // Calculate performance and earnings
  const lifetimePerformance =
    lifetime.avgQuality * 0.6 +
    (lifetime.totalHours / lifetime.entryCount || 0) * 0.4;
  const weeklyPerformance =
    weekly.avgQuality * 0.6 +
    (weekly.totalHours / weekly.entryCount || 0) * 0.4;

  const hourlyRate = parseInt(process.env.HOURLY_RATE) || 2000;

  // Calculate multipliers
  let lifetimeMultiplier = 1.0;
  let weeklyMultiplier = 1.0;

  if (benchmark && benchmark.bonusRates) {
    const { thresholds, bonusRates } = benchmark;

    // Lifetime multiplier
    if (lifetimePerformance >= thresholds.excellent)
      lifetimeMultiplier = bonusRates.excellent;
    else if (lifetimePerformance >= thresholds.good)
      lifetimeMultiplier = bonusRates.good;
    else if (lifetimePerformance >= thresholds.average)
      lifetimeMultiplier = bonusRates.average;
    else if (lifetimePerformance >= thresholds.minimum)
      lifetimeMultiplier = bonusRates.minimum;
    else lifetimeMultiplier = bonusRates.below;

    // Weekly multiplier
    if (weeklyPerformance >= thresholds.excellent)
      weeklyMultiplier = bonusRates.excellent;
    else if (weeklyPerformance >= thresholds.good)
      weeklyMultiplier = bonusRates.good;
    else if (weeklyPerformance >= thresholds.average)
      weeklyMultiplier = bonusRates.average;
    else if (weeklyPerformance >= thresholds.minimum)
      weeklyMultiplier = bonusRates.minimum;
    else weeklyMultiplier = bonusRates.below;
  }

  const lifetimeEarnings =
    lifetime.totalHours * hourlyRate * lifetimeMultiplier;
  const weeklyEarnings = weekly.totalHours * hourlyRate * weeklyMultiplier;

  // Get payment history from WeeklyPayment model
  const payments = await WeeklyPayment.find({ user: userId })
    .sort({ weekStart: -1 })
    .limit(20)
    .lean();

  res.json({
    success: true,
    data: {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        isApproved: user.isApproved,
        createdAt: user.createdAt,
        bankDetails: user.bankDetails,
      },
      lifetime: {
        totalHours: Math.round(lifetime.totalHours * 100) / 100,
        avgQuality: Math.round(lifetime.avgQuality * 100) / 100,
        entryCount: lifetime.entryCount,
        totalEarnings: Math.round(lifetimeEarnings),
      },
      weekly: {
        totalHours: Math.round(weekly.totalHours * 100) / 100,
        avgQuality: Math.round(weekly.avgQuality * 100) / 100,
        entryCount: weekly.entryCount,
        totalEarnings: Math.round(weeklyEarnings),
      },
      payments: payments.map((p) => ({
        id: p._id,
        weekStart: p.weekStart,
        weekEnd: p.weekEnd,
        weekNumber: p.weekNumber,
        year: p.year,
        hours: p.totalHours,
        quality: p.avgQuality,
        earnings: p.totalEarnings,
        paid: p.paid,
        paidDate: p.paidDate,
        status: p.status,
        extraBonus: p.extraBonus,
        extraBonusReason: p.extraBonusReason,
        notes: p.adminNotes,
      })),
    },
  });
});
/**
 * @desc Get individual worker earnings and stats
 * @route GET /api/admin/users/:id/earnings
 * @access Private (Admin, Superadmin)
 */
const getUserEarnings = asyncHandler(async (req, res) => {
  const userId = req.params.id;
  const user = await User.findById(userId);
  if (!user) throw new ApiError("User not found", 404);

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const benchmark = await Benchmark.getCurrentBenchmark();

  // Get weekly and lifetime earnings with detailed breakdown
  const [weeklyData, lifetimeData] = await Promise.all([
    Entry.aggregate([
      {
        $match: {
          worker: new mongoose.Types.ObjectId(userId),
          date: { $gte: oneWeekAgo },
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$time" },
          avgQuality: { $avg: "$quality" },
          entryCount: { $sum: 1 },
        },
      },
    ]),
    Entry.aggregate([
      { $match: { worker: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$time" },
          avgQuality: { $avg: "$quality" },
          entryCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const weekly = weeklyData[0] || {
    totalHours: 0,
    avgQuality: 0,
    entryCount: 0,
  };
  const lifetime = lifetimeData[0] || {
    totalHours: 0,
    avgQuality: 0,
    entryCount: 0,
  };

  const weeklyPerformance =
    weekly.avgQuality * 0.6 +
    (weekly.totalHours / weekly.entryCount || 0) * 0.4;
  const lifetimePerformance =
    lifetime.avgQuality * 0.6 +
    (lifetime.totalHours / lifetime.entryCount || 0) * 0.4;

  const weeklyEarnings = calculateEarnings(
    weekly.totalHours,
    weeklyPerformance,
    benchmark,
  );
  const lifetimeEarnings = calculateEarnings(
    lifetime.totalHours,
    lifetimePerformance,
    benchmark,
  );

  res.json({
    success: true,
    data: {
      worker: { id: user._id, name: user.name, email: user.email },
      weekly: {
        hours: Math.round(weekly.totalHours * 100) / 100,
        quality: Math.round(weekly.avgQuality * 100) / 100,
        entries: weekly.entryCount,
        earnings: Math.round(weeklyEarnings),
        performance: Math.round(weeklyPerformance * 100) / 100,
      },
      lifetime: {
        hours: Math.round(lifetime.totalHours * 100) / 100,
        quality: Math.round(lifetime.avgQuality * 100) / 100,
        entries: lifetime.entryCount,
        earnings: Math.round(lifetimeEarnings),
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

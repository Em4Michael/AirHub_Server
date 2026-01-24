const User = require('../models/User');
const Profile = require('../models/Profile');
const Entry = require('../models/Entry');
const Benchmark = require('../models/Benchmark');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

/**
 * @desc    Approve user signup
 * @route   PUT /api/admin/approve/:id
 * @access  Private (Admin, Superadmin)
 */
const approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  if (user.isApproved) {
    throw new ApiError('User is already approved', 400);
  }

  user.isApproved = true;
  await user.save();

  res.json({
    success: true,
    message: 'User approved successfully',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      isApproved: user.isApproved,
    },
  });
});

/**
 * @desc    Get pending signups
 * @route   GET /api/admin/pending-users
 * @access  Private (Admin, Superadmin)
 */
const getPendingUsers = asyncHandler(async (req, res) => {
  const users = await User.find({
    isApproved: false,
    role: 'user',
  }).select('-bankDetails');

  res.json({
    success: true,
    count: users.length,
    data: users,
  });
});

/**
 * @desc    Get all users
 * @route   GET /api/admin/users
 * @access  Private (Admin, Superadmin)
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, role, isApproved, search } = req.query;

  const query = {};
  
  if (role) query.role = role;
  if (isApproved !== undefined) query.isApproved = isApproved === 'true';
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const users = await User.find(query)
    .populate('assignedProfiles', 'fullName email')
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
 * @desc    Get user by ID
 * @route   GET /api/admin/users/:id
 * @access  Private (Admin, Superadmin)
 */
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .populate('assignedProfiles');

  if (!user) {
    throw new ApiError('User not found', 404);
  }

  res.json({
    success: true,
    data: user,
  });
});

/**
 * @desc    Create a new profile (account)
 * @route   POST /api/admin/profile
 * @access  Private (Admin, Superadmin)
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

  // Check if profile with email exists
  const existingProfile = await Profile.findOne({ email });
  if (existingProfile) {
    throw new ApiError('Profile with this email already exists', 400);
  }

  // Verify worker exists if provided
  if (defaultWorker) {
    const worker = await User.findById(defaultWorker);
    if (!worker) {
      throw new ApiError('Worker not found', 404);
    }
    if (worker.role !== 'user') {
      throw new ApiError('Can only assign workers with user role', 400);
    }
  }

  const profile = await Profile.create({
    email,
    password,
    fullName,
    state,
    country,
    accountBearerName,
    defaultWorker: defaultWorker || null,
  });

  // Update worker's assigned profiles
  if (defaultWorker) {
    await User.findByIdAndUpdate(defaultWorker, {
      $addToSet: { assignedProfiles: profile._id },
    });
  }

  res.status(201).json({
    success: true,
    message: 'Profile created successfully',
    data: profile,
  });
});

/**
 * @desc    Update a profile
 * @route   PUT /api/admin/profile/:id
 * @access  Private (Admin, Superadmin)
 */
const updateProfile = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id);

  if (!profile) {
    throw new ApiError('Profile not found', 404);
  }

  const allowedUpdates = [
    'email', 'password', 'fullName', 'state', 
    'country', 'accountBearerName', 'defaultWorker', 'isActive'
  ];

  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      profile[field] = req.body[field];
    }
  });

  await profile.save();

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: profile,
  });
});

/**
 * @desc    Get all profiles (ranked by performance)
 * @route   GET /api/admin/profiles
 * @access  Private (Admin, Superadmin)
 */
const getProfiles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sort = '-overallPerformance', search, workerId } = req.query;

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
      { 'temporaryAssignments.worker': workerId },
    ];
  }

  const profiles = await Profile.find(query)
    .populate('defaultWorker', 'name email')
    .populate('temporaryAssignments.worker', 'name email')
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
 * @desc    Get profile by ID with full details
 * @route   GET /api/admin/profile/:id
 * @access  Private (Admin, Superadmin)
 */
const getProfileById = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.id)
    .select('+password')  // Include password for admin
    .populate('defaultWorker', 'name email')
    .populate('temporaryAssignments.worker', 'name email');

  if (!profile) {
    throw new ApiError('Profile not found', 404);
  }

  // Get recent entries for this profile
  const entries = await Entry.find({ profile: req.params.id })
    .populate('worker', 'name email')
    .sort({ date: -1 })
    .limit(50);

  res.json({
    success: true,
    data: {
      profile,
      entries,
    },
  });
});

/**
 * @desc    Get ranked profiles by performance
 * @route   GET /api/admin/ranked-profiles
 * @access  Private (Admin, Superadmin)
 */
const getRankedProfiles = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  // Default to last 30 days
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const rankedProfiles = await Entry.aggregate([
    {
      $match: {
        date: { $gte: start, $lte: end },
      },
    },
    {
      $group: {
        _id: '$profile',
        avgTime: { $avg: '$time' },
        avgQuality: { $avg: '$quality' },
        totalTime: { $sum: '$time' },
        totalQuality: { $sum: '$quality' },
        adminAvgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
        adminAvgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
        entryCount: { $sum: 1 },
        approvedCount: { $sum: { $cond: ['$adminApproved', 1, 0] } },
      },
    },
    {
      $addFields: {
        overallPerformance: {
          $add: [
            { $multiply: ['$avgQuality', 0.6] },
            { $multiply: ['$avgTime', 0.4] },
          ],
        },
      },
    },
    { $sort: { overallPerformance: -1 } },
    {
      $lookup: {
        from: 'profiles',
        localField: '_id',
        foreignField: '_id',
        as: 'profileInfo',
      },
    },
    { $unwind: '$profileInfo' },
    {
      $project: {
        profile: '$profileInfo',
        avgTime: { $round: ['$avgTime', 2] },
        avgQuality: { $round: ['$avgQuality', 2] },
        totalTime: { $round: ['$totalTime', 2] },
        totalQuality: { $round: ['$totalQuality', 2] },
        adminAvgTime: { $round: ['$adminAvgTime', 2] },
        adminAvgQuality: { $round: ['$adminAvgQuality', 2] },
        overallPerformance: { $round: ['$overallPerformance', 2] },
        entryCount: 1,
        approvedCount: 1,
      },
    },
  ]);

  res.json({
    success: true,
    count: rankedProfiles.length,
    dateRange: { start, end },
    data: rankedProfiles,
  });
});

/**
 * @desc    Vet/approve an entry
 * @route   PUT /api/admin/vet-entry
 * @access  Private (Admin, Superadmin)
 */
const vetEntry = asyncHandler(async (req, res) => {
  const { entryId, adminTime, adminQuality, adminNotes } = req.body;

  const entry = await Entry.findById(entryId);

  if (!entry) {
    throw new ApiError('Entry not found', 404);
  }

  // Update admin values
  if (adminTime !== undefined) entry.adminTime = adminTime;
  if (adminQuality !== undefined) entry.adminQuality = adminQuality;
  if (adminNotes !== undefined) entry.adminNotes = adminNotes;
  
  entry.adminApproved = true;
  entry.approvedBy = req.user._id;
  entry.approvedAt = new Date();

  await entry.save();

  // Update profile performance stats
  await Profile.updatePerformanceStats(entry.profile);

  res.json({
    success: true,
    message: 'Entry vetted successfully',
    data: entry,
  });
});

/**
 * @desc    Get entries for review
 * @route   GET /api/admin/entries
 * @access  Private (Admin, Superadmin)
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
    .populate('worker', 'name email')
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

/**
 * @desc    Reassign worker for a profile (temporary or permanent)
 * @route   PUT /api/admin/reassign
 * @access  Private (Admin, Superadmin)
 */
const reassignWorker = asyncHandler(async (req, res) => {
  const { profileId, newWorkerId, startDate, endDate, reason, permanent } = req.body;

  const profile = await Profile.findById(profileId);
  if (!profile) {
    throw new ApiError('Profile not found', 404);
  }

  const newWorker = await User.findById(newWorkerId);
  if (!newWorker) {
    throw new ApiError('Worker not found', 404);
  }

  if (newWorker.role !== 'user') {
    throw new ApiError('Can only assign workers with user role', 400);
  }

  if (permanent) {
    // Permanent reassignment - change default worker
    const oldWorkerId = profile.defaultWorker;
    
    profile.defaultWorker = newWorkerId;
    await profile.save();

    // Update workers' assigned profiles
    if (oldWorkerId) {
      await User.findByIdAndUpdate(oldWorkerId, {
        $pull: { assignedProfiles: profileId },
      });
    }
    await User.findByIdAndUpdate(newWorkerId, {
      $addToSet: { assignedProfiles: profileId },
    });

    res.json({
      success: true,
      message: 'Worker permanently reassigned',
      data: profile,
    });
  } else {
    // Temporary reassignment
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end <= start) {
      throw new ApiError('End date must be after start date', 400);
    }

    profile.temporaryAssignments.push({
      worker: newWorkerId,
      startDate: start,
      endDate: end,
      reason: reason || 'Temporary assignment',
    });

    await profile.save();

    res.json({
      success: true,
      message: 'Worker temporarily reassigned',
      data: profile,
    });
  }
});

/**
 * @desc    Remove temporary assignment
 * @route   DELETE /api/admin/reassign/:profileId/:assignmentId
 * @access  Private (Admin, Superadmin)
 */
const removeTemporaryAssignment = asyncHandler(async (req, res) => {
  const { profileId, assignmentId } = req.params;

  const profile = await Profile.findById(profileId);
  if (!profile) {
    throw new ApiError('Profile not found', 404);
  }

  profile.temporaryAssignments = profile.temporaryAssignments.filter(
    (a) => a._id.toString() !== assignmentId
  );

  await profile.save();

  res.json({
    success: true,
    message: 'Temporary assignment removed',
    data: profile,
  });
});

/**
 * @desc    Get worker performance stats
 * @route   GET /api/admin/worker-stats
 * @access  Private (Admin, Superadmin)
 */
const getWorkerStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const stats = await Entry.getWorkerPerformanceStats(start, end);

  const benchmark = await Benchmark.getCurrentBenchmark();

  // Add performance tier to each worker
  const enrichedStats = stats.map((worker) => {
    let tier = 'average';
    let multiplier = 1;
    
    if (benchmark) {
      const percentage = benchmark.calculatePercentage(worker.avgTime, worker.avgQuality);
      tier = benchmark.getTier(percentage.overallPercentage);
      multiplier = benchmark.bonusRates[tier] || 1;
    }

    const hourlyRate = parseInt(process.env.HOURLY_RATE) || 2000;
    const baseEarnings = worker.totalTime * hourlyRate;

    return {
      ...worker,
      tier,
      multiplier,
      baseEarnings,
      finalEarnings: baseEarnings * multiplier,
    };
  });

  res.json({
    success: true,
    count: enrichedStats.length,
    dateRange: { start, end },
    benchmark: benchmark ? {
      time: benchmark.timeBenchmark,
      quality: benchmark.qualityBenchmark,
      thresholds: benchmark.thresholds,
    } : null,
    data: enrichedStats,
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
};

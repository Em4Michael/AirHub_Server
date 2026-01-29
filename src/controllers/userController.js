const User = require('../models/User');
const Profile = require('../models/Profile');
const Entry = require('../models/Entry');
const Benchmark = require('../models/Benchmark');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

/**
 * @desc    Update bank details
 * @route   PUT /api/user/bank
 * @access  Private (User)
 */
const updateBankDetails = asyncHandler(async (req, res) => {
  const { bankName, accountNumber, accountName, routingNumber } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      bankDetails: {
        bankName: bankName || '',
        accountNumber: accountNumber || '',
        accountName: accountName || '',
        routingNumber: routingNumber || '',
      },
    },
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: 'Bank details updated successfully',
    data: user,
  });
});

/**
 * @desc    Upload or update profile photo
 * @route   PUT /api/user/profile-photo
 * @access  Private (User)
 */
const updateProfilePhoto = asyncHandler(async (req, res) => {
  const { profilePhoto } = req.body;

  if (!profilePhoto) {
    throw new ApiError('Profile photo is required', 400);
  }

  // Validate base64 image format
  const base64Regex = /^data:image\/(png|jpg|jpeg|gif|webp);base64,/;
  if (!base64Regex.test(profilePhoto)) {
    throw new ApiError('Invalid image format. Please upload a valid image (PNG, JPG, JPEG, GIF, or WebP)', 400);
  }

  // Check file size (limit to 5MB)
  const sizeInBytes = (profilePhoto.length * 3) / 4;
  const maxSize = 5 * 1024 * 1024; // 5MB
  if (sizeInBytes > maxSize) {
    throw new ApiError('Image size too large. Maximum size is 5MB', 400);
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { profilePhoto },
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: 'Profile photo updated successfully',
    data: {
      profilePhoto: user.profilePhoto,
    },
  });
});

/**
 * @desc    Delete profile photo
 * @route   DELETE /api/user/profile-photo
 * @access  Private (User)
 */
const deleteProfilePhoto = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { profilePhoto: null },
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: 'Profile photo deleted successfully',
    data: {
      profilePhoto: null,
    },
  });
});

/**
 * @desc    Get user's assigned profiles
 * @route   GET /api/user/profiles
 * @access  Private (User)
 */
const getAssignedProfiles = asyncHandler(async (req, res) => {
  // Get profiles where user is default worker or has active temporary assignment
  const now = new Date();
  
  const profiles = await Profile.find({
    $or: [
      { defaultWorker: req.user._id },
      {
        temporaryAssignments: {
          $elemMatch: {
            worker: req.user._id,
            startDate: { $lte: now },
            endDate: { $gte: now },
          },
        },
      },
    ],
    isActive: true,
  }).select('fullName email state country');  // Only show allowed fields for users

  res.json({
    success: true,
    count: profiles.length,
    data: profiles,
  });
});

/**
 * @desc    Create time/quality entry for a profile
 * @route   POST /api/user/entry
 * @access  Private (User)
 */
const createEntry = asyncHandler(async (req, res) => {
  const { profileId, date, time, quality, notes } = req.body;

  // Verify profile exists and user is assigned to it
  const profile = await Profile.findById(profileId);
  if (!profile) {
    throw new ApiError('Profile not found', 404);
  }

  // Check if user is currently assigned to this profile
  const currentWorker = profile.getCurrentWorker();
  if (!currentWorker || currentWorker.toString() !== req.user._id.toString()) {
    throw new ApiError('You are not assigned to this profile', 403);
  }

  // Parse date
  const entryDate = new Date(date);
  entryDate.setHours(0, 0, 0, 0);

  // Check if entry already exists for this date
  let entry = await Entry.findOne({
    profile: profileId,
    worker: req.user._id,
    date: entryDate,
  });

  if (entry) {
    // Check if already approved - cannot edit
    if (entry.adminApproved) {
      throw new ApiError('Cannot edit an approved entry', 403);
    }

    // Update existing entry
    entry.time = time;
    entry.quality = quality;
    if (notes !== undefined) entry.notes = notes;
    await entry.save();

    res.json({
      success: true,
      message: 'Entry updated successfully',
      data: entry,
    });
  } else {
    // Create new entry
    entry = await Entry.create({
      profile: profileId,
      worker: req.user._id,
      date: entryDate,
      time,
      quality,
      notes,
    });

    res.status(201).json({
      success: true,
      message: 'Entry created successfully',
      data: entry,
    });
  }
});

/**
 * @desc    Update an existing entry
 * @route   PUT /api/user/entry/:id
 * @access  Private (User)
 */
const updateEntry = asyncHandler(async (req, res) => {
  const { time, quality, notes } = req.body;

  const entry = await Entry.findById(req.params.id);
  if (!entry) {
    throw new ApiError('Entry not found', 404);
  }

  // Check if user owns this entry
  if (entry.worker.toString() !== req.user._id.toString()) {
    throw new ApiError('You can only edit your own entries', 403);
  }

  // Check if already approved
  if (entry.adminApproved) {
    throw new ApiError('Cannot edit an approved entry', 403);
  }

  // Update fields
  if (time !== undefined) entry.time = time;
  if (quality !== undefined) entry.quality = quality;
  if (notes !== undefined) entry.notes = notes;

  await entry.save();

  res.json({
    success: true,
    message: 'Entry updated successfully',
    data: entry,
  });
});

/**
 * @desc    Get user's entries
 * @route   GET /api/user/entries
 * @access  Private (User)
 */
const getEntries = asyncHandler(async (req, res) => {
  const { startDate, endDate, profileId, page = 1, limit = 50 } = req.query;

  const query = { worker: req.user._id };

  if (startDate) {
    query.date = { ...query.date, $gte: new Date(startDate) };
  }
  if (endDate) {
    query.date = { ...query.date, $lte: new Date(endDate) };
  }
  if (profileId) {
    query.profile = profileId;
  }

  const entries = await Entry.find(query)
    .populate('profile', 'fullName email')
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
 * @desc    Get user dashboard with performance data
 * @route   GET /api/user/dashboard
 * @access  Private (User)
 */
const getDashboard = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  
  // Default to last 30 days if no dates provided
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Get entries for the period
  const entries = await Entry.find({
    worker: req.user._id,
    date: { $gte: start, $lte: end },
  })
    .populate('profile', 'fullName')
    .sort({ date: 1 });

  // Get current benchmark
  const benchmark = await Benchmark.getCurrentBenchmark() || await Benchmark.getLatestBenchmark();

  // Calculate statistics
  const totalTime = entries.reduce((sum, e) => sum + e.time, 0);
  const totalQuality = entries.reduce((sum, e) => sum + e.quality, 0);
  const avgTime = entries.length > 0 ? totalTime / entries.length : 0;
  const avgQuality = entries.length > 0 ? totalQuality / entries.length : 0;

  // Calculate weekly summaries
  const weeklySummaries = {};
  entries.forEach((entry) => {
    const key = `${entry.year}-W${entry.weekNumber}`;
    if (!weeklySummaries[key]) {
      weeklySummaries[key] = {
        week: key,
        totalTime: 0,
        totalQuality: 0,
        entries: 0,
      };
    }
    weeklySummaries[key].totalTime += entry.time;
    weeklySummaries[key].totalQuality += entry.quality;
    weeklySummaries[key].entries += 1;
  });

  // Convert to array and calculate averages
  const weeklyData = Object.values(weeklySummaries).map((week) => ({
    ...week,
    avgTime: Math.round((week.totalTime / week.entries) * 100) / 100,
    avgQuality: Math.round((week.totalQuality / week.entries) * 100) / 100,
  }));

  // Calculate performance percentages and earnings
  let performanceMetrics = null;
  let earningsData = null;
  const hourlyRate = parseInt(process.env.HOURLY_RATE) || 2000;

  if (benchmark) {
    performanceMetrics = benchmark.calculatePercentage(avgTime, avgQuality);
    earningsData = benchmark.calculateEarnings(totalTime, performanceMetrics.overallPercentage, hourlyRate);
    
    // Add extra bonus from user profile
    if (req.user.extraBonus > 0) {
      earningsData.extraBonus = req.user.extraBonus;
      earningsData.finalEarnings += req.user.extraBonus;
    }
  } else {
    // Default calculation without benchmark
    earningsData = {
      baseEarnings: totalTime * hourlyRate,
      multiplier: 1,
      tier: 'average',
      bonus: 0,
      finalEarnings: totalTime * hourlyRate,
      extraBonus: req.user.extraBonus || 0,
    };
    earningsData.finalEarnings += earningsData.extraBonus;
  }

  // Daily data for graphs
  const dailyData = entries.map((entry) => ({
    date: entry.date,
    time: entry.time,
    quality: entry.quality,
    profile: entry.profile?.fullName,
    adminApproved: entry.adminApproved,
    effectiveTime: entry.effectiveTime,
    effectiveQuality: entry.effectiveQuality,
  }));

  // Get assigned profiles count
  const assignedProfilesCount = await Profile.countDocuments({
    $or: [
      { defaultWorker: req.user._id },
      {
        temporaryAssignments: {
          $elemMatch: {
            worker: req.user._id,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() },
          },
        },
      },
    ],
  });

  res.json({
    success: true,
    data: {
      summary: {
        totalEntries: entries.length,
        totalTime: Math.round(totalTime * 100) / 100,
        totalQuality: Math.round(totalQuality * 100) / 100,
        avgTime: Math.round(avgTime * 100) / 100,
        avgQuality: Math.round(avgQuality * 100) / 100,
        overallPerformance: Math.round((avgQuality * 0.6 + avgTime * 0.4) * 100) / 100,
        assignedProfiles: assignedProfilesCount,
      },
      performance: performanceMetrics,
      earnings: earningsData,
      benchmark: benchmark ? {
        timeBenchmark: benchmark.timeBenchmark,
        qualityBenchmark: benchmark.qualityBenchmark,
        thresholds: benchmark.thresholds,
        startDate: benchmark.startDate,
        endDate: benchmark.endDate,
      } : null,
      weeklyData,
      dailyData,
      dateRange: { start, end },
    },
  });
});

/**
 * @desc    Get weekly summary for user
 * @route   GET /api/user/weekly-summary
 * @access  Private (User)
 */
const getWeeklySummary = asyncHandler(async (req, res) => {
  const { weekNumber, year } = req.query;
  
  const currentDate = new Date();
  const currentYear = year ? parseInt(year) : currentDate.getFullYear();
  const firstDayOfYear = new Date(currentYear, 0, 1);
  const pastDaysOfYear = (currentDate - firstDayOfYear) / 86400000;
  const currentWeek = weekNumber ? parseInt(weekNumber) : Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);

  const summary = await Entry.getWeeklySummary(req.user._id, currentWeek, currentYear);

  const benchmark = await Benchmark.getCurrentBenchmark();

  res.json({
    success: true,
    data: {
      week: currentWeek,
      year: currentYear,
      summary: summary[0] || {
        totalTime: 0,
        totalQuality: 0,
        avgTime: 0,
        avgQuality: 0,
        entries: 0,
      },
      benchmark: benchmark ? {
        time: benchmark.timeBenchmark,
        quality: benchmark.qualityBenchmark,
      } : null,
    },
  });
});

module.exports = {
  updateBankDetails,
  updateProfilePhoto,
  deleteProfilePhoto,
  getAssignedProfiles,
  createEntry,
  updateEntry,
  getEntries,
  getDashboard,
  getWeeklySummary,
};
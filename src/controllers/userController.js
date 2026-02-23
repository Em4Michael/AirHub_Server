const User = require('../models/User');
const Profile = require('../models/Profile');
const Entry = require('../models/Entry');
const Benchmark = require('../models/Benchmark');
const WeeklyPayment = require('../models/Payment'); // file is Payment.js
const { asyncHandler, ApiError } = require('../middleware/errorHandler');

// ─────────────────────────────────────────────────────────────────────────────
// Update Profile (phone, name, etc.)
// ─────────────────────────────────────────────────────────────────────────────
const updateProfile = asyncHandler(async (req, res) => {
  const { phone, name } = req.body;

  const updateFields = {};
  if (phone !== undefined) updateFields.phone = phone;
  if (name !== undefined) updateFields.name = name;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    updateFields,
    { new: true, runValidators: true }
  ).select('-password');

  res.json({ success: true, message: 'Profile updated successfully', data: user });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bank details
// ─────────────────────────────────────────────────────────────────────────────
const updateBankDetails = asyncHandler(async (req, res) => {
  const { bankName, accountNumber, accountName } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      bankDetails: {
        bankName: bankName || '',
        accountNumber: accountNumber || '',
        accountName: accountName || '',
      },
    },
    { new: true, runValidators: true }
  );

  res.json({ success: true, message: 'Bank details updated successfully', data: user });
});

// ─────────────────────────────────────────────────────────────────────────────
// Profile photo
// ─────────────────────────────────────────────────────────────────────────────
const updateProfilePhoto = asyncHandler(async (req, res) => {
  const photoUrl = req.body?.photo;

  if (!photoUrl) {
    throw new ApiError('Profile photo is required', 400);
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { profilePhoto: photoUrl },
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    message: 'Profile photo updated successfully',
    data: { profilePhoto: user.profilePhoto },
  });
});

const deleteProfilePhoto = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { profilePhoto: null });

  res.json({
    success: true,
    message: 'Profile photo deleted successfully',
    data: { profilePhoto: null },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assigned profiles
// ─────────────────────────────────────────────────────────────────────────────
const getAssignedProfiles = asyncHandler(async (req, res) => {
  const now = new Date();

  const profiles = await Profile.find({
    $or: [
      { defaultWorker: req.user._id },
      { secondWorker: req.user._id },
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
  }).select('fullName email state country');

  res.json({ success: true, count: profiles.length, data: profiles });
});

// ─────────────────────────────────────────────────────────────────────────────
// Entry CRUD
// ─────────────────────────────────────────────────────────────────────────────
const createEntry = asyncHandler(async (req, res) => {
  const { profileId, date, time, quality, notes } = req.body;

  const profile = await Profile.findById(profileId);
  if (!profile) throw new ApiError('Profile not found', 404);
  if (!profile.isActive) throw new ApiError('Profile is not active', 403);

  if (!profile.isWorkerAssigned(req.user._id)) {
    throw new ApiError('You are not currently assigned to this profile', 403);
  }

  const datePart = date.toString().split('T')[0];
  const [yyyy, mm, dd] = datePart.split('-').map(Number);
  if (!yyyy || !mm || !dd) throw new ApiError('Invalid date format. Use YYYY-MM-DD', 400);

  const entryDate = new Date(Date.UTC(yyyy, mm - 1, dd));

  let entry = await Entry.findOne({
    profile: profileId,
    worker: req.user._id,
    date: entryDate,
  });

  if (entry) {
    if (entry.adminApproved) {
      throw new ApiError('Cannot edit an already approved entry', 403);
    }
    entry.time = time;
    entry.quality = quality;
    if (notes !== undefined) entry.notes = notes;
    await entry.save();

    return res.json({ success: true, message: 'Entry updated successfully', data: entry });
  }

  entry = await Entry.create({
    profile: profileId,
    worker: req.user._id,
    date: entryDate,
    time,
    quality,
    notes,
  });

  res.status(201).json({ success: true, message: 'Entry submitted successfully', data: entry });
});

const updateEntry = asyncHandler(async (req, res) => {
  const { time, quality, notes } = req.body;

  const entry = await Entry.findById(req.params.id);
  if (!entry) throw new ApiError('Entry not found', 404);

  if (entry.worker.toString() !== req.user._id.toString()) {
    throw new ApiError('You can only edit your own entries', 403);
  }
  if (entry.adminApproved) {
    throw new ApiError('Cannot edit an approved entry', 403);
  }

  if (time !== undefined) entry.time = time;
  if (quality !== undefined) entry.quality = quality;
  if (notes !== undefined) entry.notes = notes;

  await entry.save();

  res.json({ success: true, message: 'Entry updated successfully', data: entry });
});

const getEntries = asyncHandler(async (req, res) => {
  const { startDate, endDate, profileId, page = 1, limit = 50 } = req.query;

  const query = { worker: req.user._id };
  if (startDate || endDate) {
    query.date = {};
    if (startDate) query.date.$gte = new Date(startDate);
    if (endDate) query.date.$lte = new Date(endDate);
  }
  if (profileId) query.profile = profileId;

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

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard – fixed version (no benchmark.calculatePercentage crash)
// ─────────────────────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------
// getDashboard — FIXED
// Remove: benchmark.calculatePercentage (does not exist on your Benchmark model)
// Remove: benchmark.calculateEarnings (not needed — payment = rate × hours only)
// ---------------------------------------------------------------------------

const getDashboard = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const end   = endDate   ? new Date(endDate)   : new Date();
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const entries = await Entry.find({
    worker: req.user._id,
    date: { $gte: start, $lte: end },
    adminApproved: true,
  })
    .populate('profile', 'fullName')
    .sort({ date: 1 });

  const benchmark =
    (await Benchmark.getCurrentBenchmark()) || (await Benchmark.getLatestBenchmark());

  const totalTime    = entries.reduce((s, e) => s + (e.adminTime    ?? e.time),    0);
  const totalQuality = entries.reduce((s, e) => s + (e.adminQuality ?? e.quality), 0);
  const avgTime      = entries.length > 0 ? totalTime    / entries.length : 0;
  const avgQuality   = entries.length > 0 ? totalQuality / entries.length : 0;

  // Performance score for display only (not used for pay)
  const overallPerformance = avgQuality * 0.6 + avgTime * 0.4;

  const weekStartDay = req.user.weekStartDay ?? 2;
  const weeklySummaries = {};
  entries.forEach((entry) => {
    const { weekStart } = WeeklyPayment.getWeekBoundaries(entry.date, weekStartDay);
    const key = weekStart.toISOString();
    if (!weeklySummaries[key]) {
      weeklySummaries[key] = { weekStart, totalTime: 0, totalQuality: 0, entries: 0 };
    }
    weeklySummaries[key].totalTime    += entry.adminTime    ?? entry.time;
    weeklySummaries[key].totalQuality += entry.adminQuality ?? entry.quality;
    weeklySummaries[key].entries      += 1;
  });

  const weeklyData = Object.values(weeklySummaries).map((w) => ({
    weekStart:  w.weekStart,
    totalTime:  Math.round(w.totalTime  * 100) / 100,
    entries:    w.entries,
    avgTime:    Math.round((w.totalTime  / w.entries) * 100) / 100,
    avgQuality: Math.round((w.totalQuality / w.entries) * 100) / 100,
  }));

  // Payment = rate × hours ONLY — no multiplier, no calculatePercentage/calculateEarnings
  const hourlyRate   = (benchmark && benchmark.payPerHour) || parseInt(process.env.HOURLY_RATE) || 2000;
  const baseEarnings = totalTime * hourlyRate;
  const extraBonus   = req.user.extraBonus || 0;

  const earningsData = {
    baseEarnings,
    multiplier:    1,
    tier:          'standard',
    bonus:         0,
    hourlyRate,
    extraBonus,
    finalEarnings: baseEarnings + extraBonus,
  };

  // Determine tier label for frontend display (no calculation, just label)
  let tierLabel = 'below';
  if      (overallPerformance >= 80) tierLabel = 'excellent';
  else if (overallPerformance >= 70) tierLabel = 'good';
  else if (overallPerformance >= 60) tierLabel = 'average';
  earningsData.tier = tierLabel;

  const dailyData = entries.map((e) => ({
    _id:              String(e._id),
    date:             e.date,
    time:             e.adminTime    ?? e.time,
    quality:          e.adminQuality ?? e.quality,
    effectiveTime:    e.adminTime    ?? e.time,
    effectiveQuality: e.adminQuality ?? e.quality,
    profile:          e.profile?.fullName || 'unknown',
    adminApproved:    e.adminApproved,
    notes:            e.notes || '',
  }));

  const now = new Date();
  const assignedProfilesCount = await Profile.countDocuments({
    $or: [
      { defaultWorker: req.user._id },
      { secondWorker:  req.user._id },
      {
        temporaryAssignments: {
          $elemMatch: {
            worker:    req.user._id,
            startDate: { $lte: now },
            endDate:   { $gte: now },
          },
        },
      },
    ],
  });

  res.json({
    success: true,
    data: {
      summary: {
        totalEntries:       entries.length,
        totalTime:          Math.round(totalTime    * 100) / 100,
        avgTime:            Math.round(avgTime      * 100) / 100,
        avgQuality:         Math.round(avgQuality   * 100) / 100,
        overallPerformance: Math.round(overallPerformance * 100) / 100,
        assignedProfiles:   assignedProfilesCount,
      },
      performance: null,   // removed — calculatePercentage doesn't exist
      earnings:    earningsData,
      benchmark: benchmark
        ? {
            timeBenchmark:    benchmark.timeBenchmark,
            qualityBenchmark: benchmark.qualityBenchmark,
            thresholds:       benchmark.thresholds,
            startDate:        benchmark.startDate,
            endDate:          benchmark.endDate,
            payPerHour:       benchmark.payPerHour,
          }
        : null,
      weeklyData,
      dailyData,
      dateRange: { start, end },
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weekly summary
// ─────────────────────────────────────────────────────────────────────────────
const getWeeklySummary = asyncHandler(async (req, res) => {
  const weekStartDay = req.user.weekStartDay ?? 2;

  const referenceDate = req.query.weekStart ? new Date(req.query.weekStart) : new Date();
  const { weekStart, weekEnd } = WeeklyPayment.getWeekBoundaries(referenceDate, weekStartDay);
  const { weekNumber, year } = WeeklyPayment.getWeekNumberAndYear(weekStart);

  const summaryRaw = await Entry.aggregate([
    {
      $match: {
        worker: req.user._id,
        date: { $gte: weekStart, $lte: weekEnd },
        adminApproved: true,
      },
    },
    {
      $group: {
        _id: null,
        totalTime: { $sum: { $ifNull: ['$adminTime', '$time'] } },
        totalQuality: { $sum: { $ifNull: ['$adminQuality', '$quality'] } },
        avgTime: { $avg: { $ifNull: ['$adminTime', '$time'] } },
        avgQuality: { $avg: { $ifNull: ['$adminQuality', '$quality'] } },
        entries: { $sum: 1 },
      },
    },
  ]);

  res.json({
    success: true,
    data: {
      weekNumber,
      year,
      weekStart,
      weekEnd,
      summary: summaryRaw[0] || {
        totalTime: 0,
        totalQuality: 0,
        avgTime: 0,
        avgQuality: 0,
        entries: 0,
      },
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment history
// ─────────────────────────────────────────────────────────────────────────────
const getMyPayments = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(500, parseInt(req.query.limit) || 50);
  const skip = (page - 1) * limit;

  const query = { user: req.user._id };
  if (req.query.paymentType) query.paymentType = req.query.paymentType;

  const [payments, total] = await Promise.all([
    WeeklyPayment.find(query)
      .sort({ weekStart: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WeeklyPayment.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: payments,
    pagination: {
      page,
      pages: Math.ceil(total / limit),
      total,
      count: payments.length,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Current user profile
// ─────────────────────────────────────────────────────────────────────────────
const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select('-password');
  if (!user) throw new ApiError('User not found', 404);
  res.json({ success: true, data: user });
});

module.exports = {
  updateProfile,
  updateBankDetails,
  updateProfilePhoto,
  deleteProfilePhoto,
  getAssignedProfiles,
  createEntry,
  updateEntry,
  getEntries,
  getDashboard,
  getWeeklySummary,
  getMyPayments,
  getProfile,
};
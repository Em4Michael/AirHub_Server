const express = require('express');
const router = express.Router();

const {
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
} = require('../controllers/adminController');

const {
  getUserWeeklyPayments,
  getWeeklyPayments,
  markWeekAsPaid,
  markBonusPaid,
  approvePayment,
  denyPayment,
  updateWeeklyPayment,
} = require('../controllers/paymentController');

const { protect, authorize } = require('../middleware/auth');
const {
  createProfileValidation,
  updateProfileValidation,
  vetEntryValidation,
  reassignWorkerValidation,
  mongoIdParam,
  paginationQuery,
  dateRangeQuery,
} = require('../middleware/validate');

// All routes require admin or superadmin
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// ── User Management ───────────────────────────────────────────────────────────

router.get('/pending-users',              getPendingUsers);
router.put('/approve/:id',  mongoIdParam('id'), approveUser);
router.put('/reject/:id',   mongoIdParam('id'), approveUser);

router.get('/users',                      getAllUsers);
router.get('/users/:id',    mongoIdParam('id'), getUserById);
router.get('/users/:id/stats',    mongoIdParam('id'), getUserStats);
router.get('/users/:id/earnings', mongoIdParam('id'), getUserEarnings);

// Payment history for a specific user (used on user-details page)
router.get('/users/:id/weekly-payments', mongoIdParam('id'), getUserWeeklyPayments);

// Pay the pending bonus for a user
//   → merges bonus into latest unpaid week, or current week if all paid
router.post('/users/:userId/mark-bonus-paid', markBonusPaid);

// ── Profile Management ────────────────────────────────────────────────────────

router.post('/profile',        createProfileValidation,  createProfile);
router.get('/profiles',        paginationQuery,           getProfiles);
router.get('/profile/:id',     mongoIdParam('id'),        getProfileById);
router.put('/profile/:id',     mongoIdParam('id'), updateProfileValidation, updateProfile);

// Delete profile + its entries
router.delete('/profile/:id',  mongoIdParam('id'), async (req, res, next) => {
  try {
    const Profile = require('../models/Profile');
    const Entry   = require('../models/Entry');
    const profile = await Profile.findById(req.params.id);
    if (!profile) return res.status(404).json({ success: false, message: 'Profile not found' });
    await Entry.deleteMany({ profile: req.params.id });
    await Profile.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Profile and associated entries deleted' });
  } catch (err) { next(err); }
});

// ── Rankings ──────────────────────────────────────────────────────────────────

router.get('/ranked-profiles', dateRangeQuery, getRankedProfiles);

// ── Entry Management ──────────────────────────────────────────────────────────

router.get('/entries',      paginationQuery, dateRangeQuery, getEntries);
router.post('/vet-entry',   vetEntryValidation, vetEntry);

router.delete('/entries/:id', mongoIdParam('id'), async (req, res, next) => {
  try {
    const Entry = require('../models/Entry');
    const entry = await Entry.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: 'Entry not found' });
    await Entry.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Entry deleted' });
  } catch (err) { next(err); }
});

// ── Worker Reassignment ───────────────────────────────────────────────────────

router.put('/reassign',    reassignWorkerValidation, reassignWorker);
router.delete('/reassign/:profileId/:assignmentId', removeTemporaryAssignment);

// ── Payment Management ────────────────────────────────────────────────────────

router.get('/weekly-payments',                          paginationQuery, getWeeklyPayments);
router.post('/mark-week-paid',                          markWeekAsPaid);
router.put('/weekly-payments/:paymentId/approve',       approvePayment);
router.put('/weekly-payments/:paymentId/deny',          denyPayment);
router.put('/weekly-payments/:paymentId',               updateWeeklyPayment);

// ── Statistics ────────────────────────────────────────────────────────────────

router.get('/worker-stats', dateRangeQuery, getWorkerStats);

module.exports = router;
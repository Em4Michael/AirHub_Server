const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');

const {
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
} = require('../controllers/superAdminController');

// Reuse admin controller's user detail + stats handlers
const {
  getAllUsers,
  getUserById,
  getUserStats,
  getUserEarnings,
} = require('../controllers/adminController');

const {
  getWeeklyPayments,
  getUserWeeklyPayments,
  approvePayment,
  denyPayment,
  markWeekAsPaid,
  markBonusPaid,
  updateWeeklyPayment,
} = require('../controllers/paymentController');

const { benchmarkValidation, mongoIdParam } = require('../middleware/validate');

// All superadmin routes require authentication + superadmin role
router.use(protect);
router.use(authorize('superadmin'));

// ── User Management ───────────────────────────────────────────────────────────

router.put('/promote/:id',    promoteToAdmin);
router.put('/demote/:id',     demoteToUser);
router.put('/revoke/:id',     revokeAccess);
router.put('/restore/:id',    restoreAccess);
router.delete('/delete/:id',  deleteUser);
router.put('/approve-all',    approveAllPending);

// Full user detail endpoints (return phone, bankDetails, extraBonus, etc.)
router.get('/users',                              getAllUsers);
router.get('/users/:id',        mongoIdParam('id'), getUserById);
router.get('/users/:id/stats',  mongoIdParam('id'), getUserStats);
router.get('/users/:id/earnings', mongoIdParam('id'), getUserEarnings);
router.get('/users/:id/weekly-payments', mongoIdParam('id'), getUserWeeklyPayments);

// Pay the pending bonus for a user (same logic as admin endpoint)
router.post('/users/:userId/mark-bonus-paid', markBonusPaid);

// ── Benchmark Management ──────────────────────────────────────────────────────

router.get('/benchmarks',             getAllBenchmarks);
router.get('/benchmark/current',      getCurrentBenchmark);
router.post('/benchmark',             benchmarkValidation, createBenchmark);
router.put('/benchmark/:id',          updateBenchmark);
router.delete('/benchmark/:id',       deleteBenchmark);

// ── Bonus Management ──────────────────────────────────────────────────────────

router.put('/bonus/:id',              addExtraBonus);
router.put('/bonus/:id/reset',        resetExtraBonus);

// ── Payment Management ────────────────────────────────────────────────────────

router.get('/payments',                                  getWeeklyPayments);
router.post('/mark-week-paid',                           markWeekAsPaid);
router.put('/payments/:paymentId/approve',               approvePayment);
router.put('/payments/:paymentId/deny',                  denyPayment);
router.put('/payments/:paymentId',                       updateWeeklyPayment);

// ── System Stats ──────────────────────────────────────────────────────────────

router.get('/stats',                  getSystemStats);

module.exports = router;
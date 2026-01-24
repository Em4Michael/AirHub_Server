const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/superAdminController');
const { protect, authorize } = require('../middleware/auth');
const {
  benchmarkValidation,
  mongoIdParam,
  paginationQuery,
} = require('../middleware/validate');

// All routes require authentication and superadmin role
router.use(protect);
router.use(authorize('superadmin'));

// User management
router.put('/promote/:id', mongoIdParam('id'), promoteToAdmin);
router.put('/demote/:id', mongoIdParam('id'), demoteToUser);
router.put('/revoke/:id', mongoIdParam('id'), revokeAccess);
router.put('/restore/:id', mongoIdParam('id'), restoreAccess);
router.delete('/delete/:id', mongoIdParam('id'), deleteUser);
router.put('/approve-all', approveAllPendingUsers);

// Benchmark management
router.get('/benchmarks', paginationQuery, getBenchmarks);
router.get('/benchmark/current', getCurrentBenchmark);
router.post('/benchmark', benchmarkValidation, createBenchmark);
router.put('/benchmark/:id', mongoIdParam('id'), updateBenchmark);
router.delete('/benchmark/:id', mongoIdParam('id'), deleteBenchmark);

// Bonus management
router.put('/bonus/:id', mongoIdParam('id'), addExtraBonus);
router.put('/bonus/:id/reset', mongoIdParam('id'), resetExtraBonus);

// System stats
router.get('/stats', getSystemStats);

module.exports = router;

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
} = require('../controllers/adminController');
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

// All routes require authentication and admin/superadmin role
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// User management
router.get('/pending-users', getPendingUsers);
router.get('/users', paginationQuery, getAllUsers);
router.get('/users/:id', mongoIdParam('id'), getUserById);
router.put('/approve/:id', mongoIdParam('id'), approveUser);

// Profile management
router.get('/profiles', paginationQuery, getProfiles);
router.get('/profile/:id', mongoIdParam('id'), getProfileById);
router.post('/profile', createProfileValidation, createProfile);
router.put('/profile/:id', mongoIdParam('id'), updateProfileValidation, updateProfile);
router.get('/ranked-profiles', dateRangeQuery, getRankedProfiles);

// Entry management
router.get('/entries', paginationQuery, dateRangeQuery, getEntries);
router.put('/vet-entry', vetEntryValidation, vetEntry);

// Worker reassignment
router.put('/reassign', reassignWorkerValidation, reassignWorker);
router.delete('/reassign/:profileId/:assignmentId', removeTemporaryAssignment);

// Statistics
router.get('/worker-stats', dateRangeQuery, getWorkerStats);

module.exports = router;

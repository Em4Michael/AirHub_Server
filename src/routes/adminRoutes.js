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

// All routes require admin/superadmin authentication
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// User Management
router.get('/pending-users', getPendingUsers);
router.put('/approve/:id', mongoIdParam('id'), approveUser);
router.put('/reject/:id', mongoIdParam('id'), approveUser); // Uses same handler with different status

// Users - Make pagination optional for the getAllUsers endpoint
router.get('/users', getAllUsers);
router.get('/users/:id', mongoIdParam('id'), getUserById);
router.get('/users/:id/stats', mongoIdParam('id'), getUserStats);
router.get('/users/:id/earnings', mongoIdParam('id'), getUserEarnings);

// Profile Management
router.post('/profile', createProfileValidation, createProfile);
router.get('/profiles', paginationQuery, getProfiles);
router.get('/profile/:id', mongoIdParam('id'), getProfileById);
router.put('/profile/:id', mongoIdParam('id'), updateProfileValidation, updateProfile);
router.delete('/profile/:id', mongoIdParam('id'), async (req, res, next) => {
  try {
    const Profile = require('../models/Profile');
    const Entry = require('../models/Entry');
    
    const profile = await Profile.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Delete all entries associated with this profile
    await Entry.deleteMany({ profile: req.params.id });

    // Delete the profile
    await Profile.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Profile and associated entries deleted successfully'
    });
  } catch (error) {
    next(error);
  }
});

// Rankings
router.get('/ranked-profiles', dateRangeQuery, getRankedProfiles);

// Entry Management
router.get('/entries', paginationQuery, dateRangeQuery, getEntries);
router.put('/vet-entry', vetEntryValidation, vetEntry);

// Worker Management
router.put('/reassign', reassignWorkerValidation, reassignWorker);
router.delete('/reassign/:profileId/:assignmentId', removeTemporaryAssignment);

// Statistics
router.get('/worker-stats', dateRangeQuery, getWorkerStats);

module.exports = router;
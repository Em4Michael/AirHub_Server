const express = require('express');
const router = express.Router();

const {
  getProfile,
  updateProfile,          // FIX: handles name + phone, was missing from routes
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
} = require('../controllers/userController');

const { protect } = require('../middleware/auth');
const {
  updateBankDetailsValidation,
  createEntryValidation,
  updateEntryValidation,
  mongoIdParam,
  paginationQuery,
  dateRangeQuery,
} = require('../middleware/validate');

const upload = require('../middleware/upload');

// All user routes require authentication
router.use(protect);

// ─── Profile ─────────────────────────────────────────────────────────────────

router.get('/profile', getProfile);

// FIX: This route was MISSING — caused 404 on PUT /api/user/profile
// Used by the profile page to update phone number (and name)
router.put('/profile', updateProfile);

// Bank details
router.put('/bank', updateBankDetailsValidation, updateBankDetails);

// Profile photo
router.put('/profile-photo', upload.single('photo'), updateProfilePhoto);
router.delete('/profile-photo', deleteProfilePhoto);

// ─── Profiles (assigned client accounts) ─────────────────────────────────────

router.get('/profiles', getAssignedProfiles);

// ─── Entries ─────────────────────────────────────────────────────────────────

router.post('/entry', createEntryValidation, createEntry);
router.put('/entry/:id', mongoIdParam('id'), updateEntryValidation, updateEntry);
router.get('/entries', paginationQuery, dateRangeQuery, getEntries);

// ─── Dashboard & payments ────────────────────────────────────────────────────

router.get('/dashboard', dateRangeQuery, getDashboard);
router.get('/weekly-summary', getWeeklySummary);
router.get('/payments', getMyPayments);

module.exports = router;
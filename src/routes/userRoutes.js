const express = require('express');
const router = express.Router();

const {
  getProfile,
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

// All user routes require authentication
router.use(protect);

// ─── Profile ─────────────────────────────────────────────────────────────────

router.get('/profile', getProfile);
router.put('/profile', updateProfile);
router.put('/bank', updateBankDetailsValidation, updateBankDetails);

// Profile photo — no multer, accepts base64 JSON body
router.put('/profile-photo', updateProfilePhoto);
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
const express = require('express');
const router = express.Router();
const {
  updateBankDetails,
  getAssignedProfiles,
  createEntry,
  updateEntry,
  getEntries,
  getDashboard,
  getWeeklySummary,
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const {
  updateBankDetailsValidation,
  createEntryValidation,
  updateEntryValidation,
  mongoIdParam,
  paginationQuery,
  dateRangeQuery,
} = require('../middleware/validate');

// All routes require authentication
router.use(protect);

// Bank details
router.put('/bank', updateBankDetailsValidation, updateBankDetails);

// Profiles
router.get('/profiles', getAssignedProfiles);

// Entries
router.post('/entry', createEntryValidation, createEntry);
router.put('/entry/:id', mongoIdParam('id'), updateEntryValidation, updateEntry);
router.get('/entries', paginationQuery, dateRangeQuery, getEntries);

// Dashboard & Stats
router.get('/dashboard', dateRangeQuery, getDashboard);
router.get('/weekly-summary', getWeeklySummary);

module.exports = router;

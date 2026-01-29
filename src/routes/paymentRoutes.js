const express = require('express');
const router = express.Router();
const {
  getWeeklyPayments,
  getUserWeeklyPayments,
  markWeekAsPaid,
  updateWeeklyPayment,
  generateWeeklyPayments,
} = require('../controllers/paymentController');
const { protect, authorize } = require('../middleware/auth');

// Apply auth middleware
router.use(protect);
router.use(authorize('admin', 'superadmin'));

// Get all weekly payments with filters
router.get('/weekly-payments', getWeeklyPayments);

// Get specific user's weekly payments
router.get('/users/:userId/weekly-payments', getUserWeeklyPayments);

// Mark a week as paid
router.post('/mark-week-paid', markWeekAsPaid);

// Update weekly payment details
router.put('/weekly-payments/:paymentId', updateWeeklyPayment);

// Generate weekly payments for all users (utility route)
router.post('/generate-weekly-payments', generateWeeklyPayments);

module.exports = router;
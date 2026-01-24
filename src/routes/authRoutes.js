const express = require('express');
const router = express.Router();
const {
  signup,
  login,
  getMe,
  updatePassword,
  updateProfile,
  forgotPassword,
  resetPassword,
  verifyResetToken,
  logout,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const {
  signupValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  updatePasswordValidation,
} = require('../middleware/validate');

// Public routes
router.post('/signup', signupValidation, signup);
router.post('/login', loginValidation, login);

// Password reset routes (public)
router.post('/forgot-password', forgotPasswordValidation, forgotPassword);
router.put('/reset-password/:token', resetPasswordValidation, resetPassword);
router.get('/verify-reset-token/:token', verifyResetToken);

// Protected routes
router.get('/me', protect, getMe);
router.put('/password', protect, updatePasswordValidation, updatePassword);
router.put('/profile', protect, updateProfile);
router.post('/logout', protect, logout);

module.exports = router;
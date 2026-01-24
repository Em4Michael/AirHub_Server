const crypto = require('crypto');
const User = require('../models/User');
const { asyncHandler, ApiError } = require('../middleware/errorHandler');
const sendEmail = require('../utils/sendEmail');

/**
 * @desc    Register a new user
 * @route   POST /api/auth/signup
 * @access  Public
 */
const signup = asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError('User with this email already exists', 400);
  }

  // Create user (not approved by default)
  const user = await User.create({
    email,
    password,
    name,
    isApproved: false,
  });

  res.status(201).json({
    success: true,
    message: 'Registration successful. Please wait for admin approval.',
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      isApproved: user.isApproved,
    },
  });
});

/**
 * @desc    Login user
 * @route   POST /api/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // Find user and include password
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    throw new ApiError('Invalid email or password', 401);
  }

  // Check if user is approved
  if (!user.isApproved) {
    throw new ApiError('Your account is pending approval. Please wait for admin approval.', 403);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new ApiError('Your account has been deactivated. Please contact admin.', 403);
  }

  // Verify password
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    throw new ApiError('Invalid email or password', 401);
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Generate token
  const token = user.generateAuthToken();

  res.json({
    success: true,
    message: 'Login successful',
    data: {
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
});

/**
 * @desc    Get current logged in user
 * @route   GET /api/auth/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .populate('assignedProfiles', 'fullName email state country');

  res.json({
    success: true,
    data: user,
  });
});

/**
 * @desc    Update password (when logged in)
 * @route   PUT /api/auth/password
 * @access  Private
 */
const updatePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user._id).select('+password');

  // Check current password
  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) {
    throw new ApiError('Current password is incorrect', 400);
  }

  // Update password
  user.password = newPassword;
  user.passwordChangedAt = new Date();
  await user.save();

  // Generate new token
  const token = user.generateAuthToken();

  res.json({
    success: true,
    message: 'Password updated successfully',
    data: { token },
  });
});

/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const allowedUpdates = ['name', 'email'];
  const updates = {};

  allowedUpdates.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  // Check if email is being changed and if it's already taken
  if (updates.email && updates.email !== req.user.email) {
    const existingUser = await User.findOne({ email: updates.email });
    if (existingUser) {
      throw new ApiError('Email already in use', 400);
    }
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, {
    new: true,
    runValidators: true,
  });

  res.json({
    success: true,
    message: 'Profile updated successfully',
    data: user,
  });
});

/**
 * @desc    Forgot password - Send reset token to email
 * @route   POST /api/auth/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  // Find user by email
  const user = await User.findOne({ email });

  if (!user) {
    // Don't reveal if email exists or not for security
    // But still return success to prevent email enumeration
    return res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  }

  // Generate reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Create reset URL
  const resetURL = `${process.env.FRONTEND_URL}/auth/reset-password/${resetToken}`;

  // Email content
  const message = `
    <h2>Password Reset Request</h2>
    <p>Hello ${user.name},</p>
    <p>You requested to reset your password for your AIRhub account.</p>
    <p>Please click the button below to reset your password:</p>
    <a href="${resetURL}" style="display: inline-block; padding: 12px 24px; background-color: #3377ff; color: white; text-decoration: none; border-radius: 8px; margin: 16px 0;">Reset Password</a>
    <p>Or copy and paste this link in your browser:</p>
    <p>${resetURL}</p>
    <p><strong>This link will expire in 1 hour.</strong></p>
    <p>If you didn't request this, please ignore this email and your password will remain unchanged.</p>
    <br>
    <p>Best regards,</p>
    <p>The AIRhub Team</p>
  `;

  try {
    await sendEmail({
      email: user.email,
      subject: 'AIRhub - Password Reset Request (Valid for 1 hour)',
      html: message,
    });

    res.json({
      success: true,
      message: 'If an account with that email exists, a password reset link has been sent.',
    });
  } catch (error) {
    // If email fails, clear the reset token
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    throw new ApiError('There was an error sending the email. Please try again later.', 500);
  }
});

/**
 * @desc    Reset password using token
 * @route   PUT /api/auth/reset-password/:token
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  // Hash the token from URL to compare with stored hash
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid reset token that hasn't expired
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError('Password reset token is invalid or has expired', 400);
  }

  // Set new password
  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.passwordChangedAt = new Date();
  await user.save();

  // Generate new auth token
  const authToken = user.generateAuthToken();

  res.json({
    success: true,
    message: 'Password has been reset successfully',
    data: {
      token: authToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  });
});

/**
 * @desc    Verify reset token (check if still valid)
 * @route   GET /api/auth/verify-reset-token/:token
 * @access  Public
 */
const verifyResetToken = asyncHandler(async (req, res) => {
  const { token } = req.params;

  // Hash the token from URL
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Find user with valid reset token
  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) {
    throw new ApiError('Password reset token is invalid or has expired', 400);
  }

  res.json({
    success: true,
    message: 'Token is valid',
    data: {
      email: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'), // Partially hide email
    },
  });
});

/**
 * @desc    Logout (optional - for token blacklist if implemented)
 * @route   POST /api/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res) => {
  // If implementing token blacklist, add token to blacklist here
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});

module.exports = {
  signup,
  login,
  getMe,
  updatePassword,
  updateProfile,
  forgotPassword,
  resetPassword,
  verifyResetToken,
  logout,
};
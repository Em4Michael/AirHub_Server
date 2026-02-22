const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((err) => ({ field: err.path, message: err.msg })),
    });
  }
  next();
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const signupValidation = [
  body('email').trim().isEmail().withMessage('Please provide a valid email').normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ max: 100 })
    .withMessage('Name cannot exceed 100 characters'),
  handleValidationErrors,
];

const loginValidation = [
  body('email').trim().isEmail().withMessage('Please provide a valid email').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors,
];

const forgotPasswordValidation = [
  body('email').trim().isEmail().withMessage('Please provide a valid email').normalizeEmail(),
  handleValidationErrors,
];

const resetPasswordValidation = [
  param('token')
    .notEmpty()
    .withMessage('Reset token is required')
    .isLength({ min: 64, max: 64 })
    .withMessage('Invalid reset token format'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
  handleValidationErrors,
];

const updatePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters')
    .custom((value, { req }) => {
      if (value === req.body.currentPassword)
        throw new Error('New password must be different from current password');
      return true;
    }),
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// Profile photo — validated by multer; no body validation needed here
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Profile (client account)
// ---------------------------------------------------------------------------

const createProfileValidation = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  /**
   * Password is OPTIONAL — if omitted, the controller auto-generates one.
   * Spec: "Generate a random password if not provided."
   */
  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('fullName').trim().notEmpty().withMessage('Full name is required'),
  body('state').trim().notEmpty().withMessage('State is required'),
  body('country').trim().notEmpty().withMessage('Country is required'),
  body('accountBearerName').trim().notEmpty().withMessage('Account bearer name is required'),
  body('defaultWorker').optional().isMongoId().withMessage('Invalid defaultWorker ID'),
  /**
   * Optional second worker — spec allows up to 2 concurrent workers per profile.
   */
  body('secondWorker').optional().isMongoId().withMessage('Invalid secondWorker ID'),
  handleValidationErrors,
];

const updateProfileValidation = [
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('fullName').optional().trim().notEmpty().withMessage('Full name cannot be empty'),
  body('state').optional().trim().notEmpty().withMessage('State cannot be empty'),
  body('country').optional().trim().notEmpty().withMessage('Country cannot be empty'),
  body('accountBearerName')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Account bearer name cannot be empty'),
  body('defaultWorker').optional().isMongoId().withMessage('Invalid defaultWorker ID'),
  body('secondWorker').optional().isMongoId().withMessage('Invalid secondWorker ID'),
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const createEntryValidation = [
  body('profileId').isMongoId().withMessage('Invalid profile ID'),
  body('date').isISO8601().withMessage('Please provide a valid date'),
  body('time')
    .isFloat({ min: 0, max: 24 })
    .withMessage('Time must be between 0 and 24 hours'),
  body('quality')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Quality must be between 0 and 100'),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),
  handleValidationErrors,
];

const updateEntryValidation = [
  body('time')
    .optional()
    .isFloat({ min: 0, max: 24 })
    .withMessage('Time must be between 0 and 24 hours'),
  body('quality')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Quality must be between 0 and 100'),
  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters'),
  handleValidationErrors,
];

const vetEntryValidation = [
  body('entryId').isMongoId().withMessage('Invalid entry ID'),
  body('adminTime')
    .optional()
    .isFloat({ min: 0, max: 24 })
    .withMessage('Admin time must be between 0 and 24 hours'),
  body('adminQuality')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Admin quality must be between 0 and 100'),
  body('adminNotes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Admin notes cannot exceed 500 characters'),
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

const benchmarkValidation = [
  body('timeBenchmark')
    .isFloat({ min: 0 })
    .withMessage('Time benchmark must be a positive number'),
  body('qualityBenchmark')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Quality benchmark must be between 0 and 100'),
  body('startDate').isISO8601().withMessage('Please provide a valid start date'),
  body('endDate')
    .isISO8601()
    .withMessage('Please provide a valid end date')
    .custom((value, { req }) => {
      if (new Date(value) <= new Date(req.body.startDate))
        throw new Error('End date must be after start date');
      return true;
    }),
  /**
   * payPerHour — optional. When set, all earnings calculations for this
   * benchmark period will use this rate instead of the HOURLY_RATE env var.
   * Falls back to: HOURLY_RATE env → 2000 NGN default.
   */
  body('payPerHour')
    .optional({ nullable: true })
    .isFloat({ min: 1 })
    .withMessage('Pay per hour must be at least 1'),
  body('thresholds').optional().isObject().withMessage('Thresholds must be an object'),
  body('bonusRates').optional().isObject().withMessage('Bonus rates must be an object'),
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// User — bank details (routingNumber removed)
// ---------------------------------------------------------------------------

const updateBankDetailsValidation = [
  body('bankName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Bank name cannot exceed 100 characters'),
  body('accountNumber')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Account number cannot exceed 50 characters'),
  body('accountName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Account name cannot exceed 100 characters'),
  // routingNumber REMOVED from validation per spec
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// Reassignment
// ---------------------------------------------------------------------------

const reassignWorkerValidation = [
  body('profileId').isMongoId().withMessage('Invalid profile ID'),
  body('newWorkerId').isMongoId().withMessage('Invalid worker ID'),
  body('permanent')
    .optional()
    .isBoolean()
    .withMessage('permanent must be a boolean'),
  body('slot')
    .optional()
    .isIn(['default', 'second'])
    .withMessage('slot must be "default" or "second"'),
  // startDate/endDate only required for temporary assignments
  body('startDate')
    .if(body('permanent').not().equals('true'))
    .isISO8601()
    .withMessage('Please provide a valid start date'),
  body('endDate')
    .if(body('permanent').not().equals('true'))
    .isISO8601()
    .withMessage('Please provide a valid end date')
    .custom((value, { req }) => {
      if (req.body.permanent) return true;
      if (new Date(value) <= new Date(req.body.startDate))
        throw new Error('End date must be after start date');
      return true;
    }),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Reason cannot exceed 200 characters'),
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// User account creation — weekStartDay
// ---------------------------------------------------------------------------

/**
 * Validation for admin setting a user's weekStartDay (0-6, default 2 = Tuesday).
 * Used when creating or updating a user account.
 */
const weekStartDayValidation = [
  body('weekStartDay')
    .optional()
    .isInt({ min: 0, max: 6 })
    .withMessage('weekStartDay must be an integer between 0 (Sunday) and 6 (Saturday)'),
  handleValidationErrors,
];

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const mongoIdParam = (paramName = 'id') => [
  param(paramName).isMongoId().withMessage(`Invalid ${paramName}`),
  handleValidationErrors,
];

const paginationQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('sort').optional().isString().withMessage('Sort must be a string'),
  handleValidationErrors,
];

const dateRangeQuery = [
  query('startDate').optional().isISO8601().withMessage('Invalid start date'),
  query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  handleValidationErrors,
];

module.exports = {
  handleValidationErrors,
  signupValidation,
  loginValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  updatePasswordValidation,
  createProfileValidation,
  updateProfileValidation,
  createEntryValidation,
  updateEntryValidation,
  vetEntryValidation,
  benchmarkValidation,
  updateBankDetailsValidation,
  reassignWorkerValidation,
  weekStartDayValidation,
  mongoIdParam,
  paginationQuery,
  dateRangeQuery,
}; 
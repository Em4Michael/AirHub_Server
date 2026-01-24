const { protect, authorize, ownerOrAdmin, optionalAuth } = require('./auth');
const { ApiError, asyncHandler, errorHandler, notFound } = require('./errorHandler');
const validators = require('./validate');

module.exports = {
  protect,
  authorize,
  ownerOrAdmin,
  optionalAuth,
  ApiError,
  asyncHandler,
  errorHandler,
  notFound,
  ...validators,
};

// src/routes/index.js  (optional helper file)

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const adminRoutes = require('./adminRoutes');
const paymentRoutes = require('./paymentRoutes');
const superAdminRoutes = require('./superAdminRoutes');

module.exports = {
  authRoutes,
  userRoutes,
  adminRoutes,
  paymentRoutes,
  superAdminRoutes
};
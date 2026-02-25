const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone number cannot exceed 20 characters'],
      default: null,
    },
    role: {
      type: String,
      enum: ['user', 'admin', 'superadmin'],
      default: 'user',
    },
    /**
     * status mirrors isApproved but as a string for frontend badge display.
     * Values: 'pending' | 'approved' | 'revoked'
     * Set explicitly on approve/revoke; derived from isApproved for old docs.
     */
    status: {
      type: String,
      enum: ['pending', 'approved', 'revoked'],
      default: 'pending',
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    profilePhoto: {
      type: String,
      default: null,
    },
    // Bank details for payments — routingNumber intentionally removed per spec
    bankDetails: {
      bankName: {
        type: String,
        trim: true,
        maxlength: [100, 'Bank name cannot exceed 100 characters'],
      },
      accountNumber: {
        type: String,
        trim: true,
        maxlength: [50, 'Account number cannot exceed 50 characters'],
      },
      accountName: {
        type: String,
        trim: true,
        maxlength: [100, 'Account name cannot exceed 100 characters'],
      },
    },
    /**
     * weekStartDay: 0 = Sunday, 1 = Monday, 2 = Tuesday (default), …, 6 = Saturday
     */
    weekStartDay: {
      type: Number,
      default: 2,
      min: [0, 'Week start day must be 0–6'],
      max: [6, 'Week start day must be 0–6'],
    },
    assignedProfiles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
      },
    ],
    extraBonus: {
      type: Number,
      default: 0,
    },
    extraBonusReason: {
      type: String,
      default: '',
    },
    // Password reset fields
    passwordResetToken:   String,
    passwordResetExpires: Date,
    passwordChangedAt:    Date,
    lastLogin:            Date,
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────

// Original indexes
userSchema.index({ email: 1 });
userSchema.index({ role: 1, isApproved: 1 });
userSchema.index({ passwordResetToken: 1, passwordResetExpires: 1 });

// FIX: Sort performance indexes — prevent "Sort exceeded memory limit of
//      33554432 bytes" on MongoDB Atlas M0 / free-tier clusters.
//      With these indexes MongoDB resolves the sort via the index without
//      loading all documents into memory, making allowDiskUse a safety net
//      rather than a requirement.
userSchema.index({ createdAt: -1 });                        // covers default sort
userSchema.index({ role: 1,       createdAt: -1 });         // covers role-filtered list
userSchema.index({ isApproved: 1, role: 1, createdAt: -1 }); // covers pending-users query

// ── Hooks ─────────────────────────────────────────────────────────────────────

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Track passwordChangedAt
userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();
  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// Keep status in sync with isApproved / isActive so old documents that
// pre-date the status field still have a consistent value.
userSchema.pre('save', function (next) {
  if (this.isModified('isApproved') || this.isModified('isActive') || this.isNew) {
    if (!this.isActive) {
      this.status = 'revoked';
    } else if (this.isApproved) {
      this.status = 'approved';
    } else {
      this.status = this.status || 'pending';
    }
  }
  next();
});

// ── Instance methods ──────────────────────────────────────────────────────────

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.generateAuthToken = function () {
  return jwt.sign(
    { id: this._id, email: this.email, role: this.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d' }
  );
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');
  this.passwordResetToken   = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.passwordResetExpires = Date.now() + 60 * 60 * 1000;
  return resetToken;
};

userSchema.virtual('displayName').get(function () {
  return this.name;
});

userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.passwordResetToken;
  delete user.passwordResetExpires;
  delete user.__v;
  return user;
};

module.exports = mongoose.model('User', userSchema);
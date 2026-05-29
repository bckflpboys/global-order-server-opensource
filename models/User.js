// New Order Global — User Model (Self-Hosted)
// No rate limits, no Lemon Squeezy, no suspension — this is for self-hosted use.

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 254,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format']
  },
  passwordHash: {
    type: String,
    required: true,
    select: false
  },
  displayName: {
    type: String,
    default: '',
    maxlength: 100,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },

  // === Plan — self-hosted users always get super_agent ===
  plan: {
    type: String,
    enum: ['free', 'pro', 'unlimited'],
    default: 'unlimited'
  },

  // === Subscription — always active super_agent for self-hosted ===
  subscription: {
    plan: {
      type: String,
      enum: ['none', 'monthly', 'yearly', 'super_agent'],
      default: 'super_agent'
    },
    status: {
      type: String,
      enum: ['none', 'active', 'cancelled', 'expired', 'past_due', 'paused'],
      default: 'active'
    },
    currentPeriodEnd: {
      type: Date,
      default: null
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false
    },
    lastCreditGrant: {
      type: Date,
      default: null
    }
  },

  // === Credit System — unlimited for self-hosted ===
  credits: {
    type: Number,
    default: 999999,
    min: 0
  },
  totalCreditsPurchased: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCreditsUsed: {
    type: Number,
    default: 0,
    min: 0
  },

  // === Usage Tracking ===
  aiRequestsUsed: {
    type: Number,
    default: 0,
    min: 0
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  },

  // === Onboarding ===
  onboardingCompleted: {
    type: Boolean,
    default: false
  },
  onboardingCompletedAt: {
    type: Date,
    default: null
  },

  // === Model Preferences ===
  builderModel: {
    type: String,
    default: null
  },
  agentModel: {
    type: String,
    default: null
  }
});

// Self-hosted: always allowed, no rate limits, no credit checks
userSchema.methods.canMakeAIRequest = function () {
  return { allowed: true };
};

userSchema.methods.recordDailyRequest = function () {
  // no-op for self-hosted
};

userSchema.methods.getDailyRequestLimit = function () {
  return Infinity;
};

userSchema.methods.hasActiveSubscription = function () {
  return true;
};

// Safe user object for API responses
userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    plan: this.plan,
    subscription: {
      plan: this.subscription?.plan || 'super_agent',
      status: this.subscription?.status || 'active',
      currentPeriodEnd: this.subscription?.currentPeriodEnd || null,
      cancelAtPeriodEnd: this.subscription?.cancelAtPeriodEnd || false
    },
    credits: this.credits,
    totalCreditsPurchased: this.totalCreditsPurchased,
    totalCreditsUsed: this.totalCreditsUsed,
    aiRequestsUsed: this.aiRequestsUsed,
    createdAt: this.createdAt,
    lastLogin: this.lastLogin,
    onboardingCompleted: !!this.onboardingCompleted,
    builderModel: this.builderModel || null,
    agentModel: this.agentModel || null
  };
};

userSchema.pre('save', function (next) {
  if (this.credits < 0) this.credits = 0;
  next();
});

module.exports = mongoose.model('User', userSchema);

// New Order Global — User Model (Security Hardened)

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    maxlength: 254, // RFC 5321 max email length
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format']
  },
  passwordHash: {
    type: String,
    required: true,
    select: false // Don't include in queries by default
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

  // === Account Status ===
  isSuspended: {
    type: Boolean,
    default: false
  },
  suspendedReason: {
    type: String,
    default: ''
  },
  suspendedAt: {
    type: Date,
    default: null
  },

  // === Plan ===
  plan: {
    type: String,
    enum: ['free', 'pro', 'unlimited'],
    default: 'free'
  },

  // === Subscription ===
  subscription: {
    plan: {
      type: String,
      enum: ['none', 'monthly', 'yearly', 'super_agent'],
      default: 'none'
    },
    status: {
      type: String,
      enum: ['none', 'active', 'cancelled', 'expired', 'past_due', 'paused'],
      default: 'none'
    },
    lemonSqueezySubscriptionId: {
      type: String,
      default: null
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

  // === Credit System ===
  credits: {
    type: Number,
    default: 20, // Free users get 20 credits on signup (one-time)
    min: 0       // PREVENT negative credits at schema level
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

  // === Rate Limiting (per day) ===
  dailyRequestCount: {
    type: Number,
    default: 0,
    min: 0
  },
  dailyRequestDate: {
    type: String, // 'YYYY-MM-DD'
    default: ''
  },

  // === Lemon Squeezy ===
  lemonSqueezyCustomerId: {
    type: String,
    default: null
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

// email is already indexed via unique:true
// isSuspended already has index:true in schema

// Check if user can make AI requests (has credits + not rate limited + not suspended)
userSchema.methods.canMakeAIRequest = function () {
  // Must not be suspended
  if (this.isSuspended) return { allowed: false, reason: 'suspended' };

  // Must have credits
  if (this.credits <= 0) return { allowed: false, reason: 'no_credits' };

  // Daily rate limit based on subscription tier
  const dailyLimit = this.getDailyRequestLimit();
  const today = new Date().toISOString().split('T')[0];
  if (this.dailyRequestDate === today && this.dailyRequestCount >= dailyLimit) {
    return { allowed: false, reason: 'rate_limited' };
  }

  return { allowed: true };
};

// Record a daily request
userSchema.methods.recordDailyRequest = function () {
  const today = new Date().toISOString().split('T')[0];
  if (this.dailyRequestDate !== today) {
    this.dailyRequestDate = today;
    this.dailyRequestCount = 0;
  }
  this.dailyRequestCount += 1;
};

// Get daily request limit based on subscription
// Mirrors AGENT_TIERS.<tier>.dailyRequestLimit in services/agentTiers.js
userSchema.methods.getDailyRequestLimit = function () {
  if (this.subscription?.status === 'active') {
    if (this.subscription.plan === 'super_agent') return 500;
    if (this.subscription.plan === 'yearly') return 200;
    if (this.subscription.plan === 'monthly') return 150;
  }
  return 50; // free tier
};

// Check if user has an active subscription
userSchema.methods.hasActiveSubscription = function () {
  return this.subscription?.status === 'active' &&
    this.subscription?.plan !== 'none';
};

// Safe user object for API responses (no password hash, no internal fields)
userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    email: this.email,
    displayName: this.displayName,
    role: this.role,
    plan: this.plan,
    subscription: {
      plan: this.subscription?.plan || 'none',
      status: this.subscription?.status || 'none',
      currentPeriodEnd: this.subscription?.currentPeriodEnd || null,
      cancelAtPeriodEnd: this.subscription?.cancelAtPeriodEnd || false
    },
    credits: Number(this.credits.toFixed(4)),
    totalCreditsPurchased: this.totalCreditsPurchased,
    totalCreditsUsed: this.totalCreditsUsed,
    aiRequestsUsed: this.aiRequestsUsed,
    isSuspended: this.isSuspended,
    createdAt: this.createdAt,
    lastLogin: this.lastLogin,
    onboardingCompleted: !!this.onboardingCompleted,
    builderModel: this.builderModel || null,
    agentModel: this.agentModel || null
  };
};

// Prevent users from modifying sensitive fields directly
userSchema.pre('save', function (next) {
  // Ensure credits never go negative (belt-and-suspenders)
  if (this.credits < 0) this.credits = 0;
  next();
});

module.exports = mongoose.model('User', userSchema);

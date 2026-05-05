// New Order Global — Onboarding Model

const mongoose = require('mongoose');

const onboardingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // === Legal Agreements ===
  tosAccepted: {
    type: Boolean,
    default: false
  },
  tosAcceptedAt: {
    type: Date,
    default: null
  },
  privacyAccepted: {
    type: Boolean,
    default: false
  },
  privacyAcceptedAt: {
    type: Date,
    default: null
  },

  // === Onboarding Questions ===
  whereDidYouHearAboutUs: {
    type: String,
    enum: ['social_media', 'friend', 'search_engine', 'product_hunt', 'other'],
    default: null
  },
  whereDidYouHearAboutUsOther: {
    type: String,
    default: '',
    maxlength: 200
  },

  intendedFeatures: {
    type: [String],
    enum: ['tool_builder', 'global_executive', 'both', 'other'],
    default: []
  },
  intendedFeaturesOther: {
    type: String,
    default: '',
    maxlength: 200
  },

  // === Onboarding Completion ===
  completed: {
    type: Boolean,
    default: false
  },
  completedAt: {
    type: Date,
    default: null
  },

  // === Metadata ===
  currentStep: {
    type: Number,
    default: 0
  },
  startedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// userId already has unique: true which creates an index

module.exports = mongoose.model('Onboarding', onboardingSchema);

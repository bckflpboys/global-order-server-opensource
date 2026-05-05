// New Order Global — AI Model Schema
// Stores available AI models and their credit pricing

const mongoose = require('mongoose');

const aiModelSchema = new mongoose.Schema({
  modelId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  openRouterId: {
    type: String,
    required: true
  },
  tier: {
    type: String,
    enum: ['free', 'standard', 'premium'],
    default: 'standard'
  },
  description: {
    type: String,
    default: ''
  },
  contextWindow: {
    type: Number,
    default: 128000
  },
  // Credit cost per 1K tokens (10 credits ≈ $1 USD)
  creditsPerInputToken: {
    type: Number,
    required: true,
    default: 0.01
  },
  creditsPerOutputToken: {
    type: Number,
    required: true,
    default: 0.05
  },
  isEnabled: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  isAgentModel: {
    type: Boolean,
    default: false
  },
  // Whether this model can accept image_url content (used by the agent's
  // screenshot feature). Only vision-capable models should have this set.
  isVisionModel: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, { timestamps: true });



module.exports = mongoose.model('AIModel', aiModelSchema);

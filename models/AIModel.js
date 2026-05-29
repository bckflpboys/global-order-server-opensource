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
  // Legacy field — kept for back-compat. For new models, prefer `apiModelId`
  // combined with `provider`. Reads/writes still mirror to apiModelId.
  openRouterId: {
    type: String,
    required: true
  },
  // Which AI provider this model is served by. Determines API URL + key.
  // - 'openrouter' (default) uses OPENROUTER_API_KEY
  // - 'openai'     uses OPENAI_API_KEY
  // - 'deepseek'   uses DEEPSEEK_API_KEY
  provider: {
    type: String,
    enum: ['openrouter', 'openai', 'deepseek'],
    default: 'openrouter'
  },
  // Provider-specific model identifier (e.g. 'openai/gpt-4o-mini' for
  // openrouter, 'gpt-4o-mini' for openai, 'deepseek-chat' for deepseek).
  // Falls back to `openRouterId` when empty for back-compat.
  apiModelId: {
    type: String,
    default: ''
  },
  // Which subscription plans are allowed to use this model. Empty array
  // means "everyone" (no gating). Self-hosted: always empty (no gating).
  allowedPlans: {
    type: [String],
    enum: ['free', 'monthly', 'yearly', 'super_agent'],
    default: []
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
  // Credit cost per 1K tokens — self-hosted: not enforced (unlimited credits)
  creditsPerInputToken: {
    type: Number,
    required: true,
    default: 0
  },
  creditsPerOutputToken: {
    type: Number,
    required: true,
    default: 0
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

// Global Executive — Per-User Agent Settings
// User-configurable knobs for the agent. Anything here is CLAMPED by the
// user's tier in services/agentTiers.js at read-time — users can only
// REDUCE limits below their tier's ceiling, never raise above it.
//
// Read via services/agentTiers.js `getEffectiveAgentTier(user)` which
// merges these overrides on top of the raw tier config.

const mongoose = require('mongoose');

// Per-user screenshot policy — fine-grained control over WHEN the agent
// should auto-take screenshots, independent of its own judgement. All
// triggers are additive; the hard cap (maxScreenshotsPerTask) still
// applies. If the user is on a tier with canUseScreenshots=false, the
// whole policy is ignored.
const screenshotPolicySchema = new mongoose.Schema({
  // Auto-capture as the FIRST step of every task (before any reasoning).
  onTaskStart: { type: Boolean, default: false },
  // Auto-capture every N agent steps (0 = disabled).
  everyNSteps: { type: Number, default: 0, min: 0, max: 50 },
  // Nudge the agent to screenshot before click/type/select actions.
  beforeInteraction: { type: Boolean, default: false },
  // Nudge the agent to screenshot after goto / openTab / reload.
  afterNavigation: { type: Boolean, default: false },
  // Nudge the agent to screenshot whenever a step returns success:false.
  onError: { type: Boolean, default: false },
  // Auto-screenshot on pages where readPage reports renderingCanvasHeavy.
  onCanvasHeavy: { type: Boolean, default: true }
}, { _id: false });

// Council role assignment — each role can be backed by a specific model
// from AIModel (identified by its openRouterId). null = use task's default.
const councilRolesSchema = new mongoose.Schema({
  strategist: { type: String, default: '' },
  executor:   { type: String, default: '' },
  critic:     { type: String, default: '' },
  optimizer:  { type: String, default: '' }
}, { _id: false });

const agentSettingsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },

  // ---- Hard-limit overrides (must be <= tier ceiling) ----
  // 0 or null = use the tier default.
  maxSteps: { type: Number, default: 0, min: 0, max: 500 },
  maxScreenshotsPerTask: { type: Number, default: 0, min: 0, max: 10 },
  maxScreenshotsPerStep: { type: Number, default: 0, min: 0, max: 3 },

  // ---- Screenshot policy (fine-grained when-to-shoot control) ----
  screenshotPolicy: { type: screenshotPolicySchema, default: () => ({}) },

  // ---- Behavioural knobs ----
  // 0-1; null = use tier default.
  temperature: { type: Number, default: null, min: 0, max: 1 },
  // Extra free-form rules the agent must follow for EVERY task (not
  // per-domain). Short, bulleted, 2000 chars max. Rendered inline in the
  // system prompt as "## USER RULES".
  customRules: { type: String, default: '', maxlength: 2000, trim: true },

  // ---- Memory controls ----
  memoryEnabled: { type: Boolean, default: true },
  // If true, the system auto-extracts memories from completed tasks.
  // If false, only manual UI entries are stored.
  autoExtractMemories: { type: Boolean, default: true },

  // ---- Council role assignment (Super Agent) ----
  councilRoles: { type: councilRolesSchema, default: () => ({}) },

  // ---- Sub-agent mode (Super Agent) ----
  // Default max parallel workers when the agent spawns sub-agents.
  maxSubAgents: { type: Number, default: 3, min: 1, max: 10 },

  // ---- Session persistence (Super Agent) ----
  // If true, completed tasks save their state for `resume yesterday` flows.
  sessionPersistenceEnabled: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('AgentSettings', agentSettingsSchema);

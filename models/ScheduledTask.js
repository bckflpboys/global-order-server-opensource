// Global Executive — Scheduled Task Model
// Lets users schedule recurring agent tasks ("every Monday 9am, check my
// inventory and email me a summary"). A cron-style worker (see
// services/scheduleRunner.js) wakes up, picks up due tasks, and creates
// a fresh AgentTask from each one.
//
// Tier-gated: `canScheduleTasks` + `maxScheduledTasks` from agentTiers.js.

const mongoose = require('mongoose');

const scheduledTaskSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Human-friendly name, shown in the UI.
  name: {
    type: String,
    required: true,
    maxlength: 120,
    trim: true
  },
  // The actual agent prompt that will be executed (same field as
  // AgentTask.originalPrompt).
  prompt: {
    type: String,
    required: true,
    maxlength: 5000,
    trim: true
  },
  // Copilot requires the user to be online; auto-pilot is always safe.
  // Scheduled tasks default to auto-pilot for that reason.
  mode: {
    type: String,
    enum: ['copilot', 'autopilot'],
    default: 'autopilot'
  },
  // Pre-supplied briefing inputs (so the agent doesn't need to ask at run
  // time). Mirror of AgentTask.briefing.
  briefing: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Permissions pre-granted for every run.
  permissions: {
    createAccounts: { type: Boolean, default: false },
    sendMessages: { type: Boolean, default: false },
    postPublicly: { type: Boolean, default: false },
    makePayments: { type: Boolean, default: false },
    deleteData: { type: Boolean, default: false },
    uploadFiles: { type: Boolean, default: false }
  },

  // ---- Schedule ----
  // Standard cron (5-field) in UTC. E.g. "0 9 * * 1" = every Monday 9am UTC.
  cron: {
    type: String,
    required: true,
    maxlength: 120,
    trim: true
  },
  // User's IANA timezone (e.g. "Africa/Johannesburg") used to interpret
  // the cron. Stored on top of UTC cron so the UI can round-trip.
  timezone: {
    type: String,
    default: 'UTC',
    maxlength: 64,
    trim: true
  },

  // ---- State ----
  enabled: { type: Boolean, default: true, index: true },
  // Set by the worker each time it picks the task up for scheduling.
  nextRunAt: { type: Date, default: null, index: true },
  lastRunAt: { type: Date, default: null },
  lastTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentTask',
    default: null
  },
  lastRunStatus: {
    type: String,
    enum: ['never', 'success', 'failed', 'cancelled'],
    default: 'never'
  },
  lastRunError: { type: String, default: '' },
  runCount: { type: Number, default: 0 },

  // Model override (optional) — otherwise uses the user's default agent model.
  modelId: { type: String, default: '' },

  // Origin channel to send notifications back to.
  source: {
    type: String,
    enum: ['web', 'telegram', 'whatsapp'],
    default: 'web'
  }
}, { timestamps: true });

scheduledTaskSchema.index({ userId: 1, enabled: 1, nextRunAt: 1 });

module.exports = mongoose.model('ScheduledTask', scheduledTaskSchema);

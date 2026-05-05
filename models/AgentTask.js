// Global Executive — Agent Task Model
// Tracks autonomous browser agent tasks and their execution steps

const mongoose = require('mongoose');

// Individual action step within a task
const agentStepSchema = new mongoose.Schema({
  stepNumber: { type: Number, required: true },
  thought: { type: String, default: '' },
  action: { type: String, required: true },
  params: { type: mongoose.Schema.Types.Mixed, default: {} },
  expectation: { type: String, default: '' },
  result: { type: mongoose.Schema.Types.Mixed, default: null },
  error: { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'executing', 'completed', 'failed', 'skipped'],
    default: 'pending'
  },
  creditsUsed: { type: Number, default: 0 },
  model: { type: String, default: '' },
  inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  duration: { type: Number, default: 0 }, // ms to execute
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

// Tracked tab info
const trackedTabSchema = new mongoose.Schema({
  tabIndex: { type: Number, required: true },
  tabId: { type: Number, default: null }, // Chrome tab ID (ephemeral)
  url: { type: String, default: '' },
  title: { type: String, default: '' },
  openedByAgent: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active'
  }
}, { _id: false });

const agentTaskSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title: {
    type: String,
    default: 'New Task'
  },
  originalPrompt: {
    type: String,
    required: true
  },
  status: {
    type: String,
    // 'briefing' = waiting for user to fill briefing form
    // 'awaiting_user' = paused on askUser/confirmAction in co-pilot
    enum: ['pending', 'planning', 'briefing', 'running', 'awaiting_user', 'paused', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  // ============================================
  // Pilot Mode & Pre-task Plan
  // ============================================
  mode: {
    type: String,
    // 'subagents' = parent task that orchestrates one or more child tasks
    // running in parallel. Each child runs in autopilot.
    enum: ['copilot', 'autopilot', 'subagents'],
    default: 'copilot',
    index: true
  },
  // ============================================
  // Origin / lineage
  // ============================================
  // Set when this task was spawned by a ScheduledTask cron.
  scheduledTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ScheduledTask',
    default: null
  },
  // Set when this task was spawned by a parent agent (sub-agents mode).
  parentTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentTask',
    default: null,
    index: true
  },
  // Set when this task was resumed from a previous completed one (Super
  // Agent session persistence).
  resumedFromId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentTask',
    default: null
  },
  triggeredBy: {
    type: String,
    enum: ['user', 'schedule', 'subagent', 'resume'],
    default: 'user'
  },
  // Phase-0 plan produced before execution (LLM output)
  plan: {
    goal: { type: String, default: '' },
    summary: { type: String, default: '' },
    steps: [{ _id: false, n: Number, description: String, risk: { type: String, enum: ['low', 'medium', 'high'], default: 'low' } }],
    candidateSites: [{ type: String }],
    risks: [{ type: String }],
    estimatedSteps: { type: Number, default: 0 }
  },
  // Inputs the agent declared it needs from the user up-front.
  // Each: { name, label, type (text|password|email|select|textarea|boolean), required, options?, sensitive? }
  requiredInputs: [{
    _id: false,
    name: String,
    label: String,
    type: { type: String, default: 'text' },
    required: { type: Boolean, default: false },
    options: [String],
    sensitive: { type: Boolean, default: false },
    description: String
  }],
  // User-provided answers to requiredInputs. Sensitive values are still stored
  // as plain strings here (encrypt at rest if needed via DB-level encryption).
  // Substituted into action params at execution time as ${input.<name>}.
  briefing: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Permissions the user explicitly granted for this task in auto-pilot.
  permissions: {
    createAccounts: { type: Boolean, default: false },
    sendMessages: { type: Boolean, default: false },
    postPublicly: { type: Boolean, default: false },
    makePayments: { type: Boolean, default: false },  // never default true
    deleteData: { type: Boolean, default: false },
    uploadFiles: { type: Boolean, default: false }
  },
  // Pending question / confirmation when status='awaiting_user'
  pendingQuestion: {
    kind: { type: String, enum: ['askUser', 'confirmAction', null], default: null },
    text: { type: String, default: '' },
    choices: [{ type: String }],
    pendingAction: { type: mongoose.Schema.Types.Mixed, default: null }, // for confirmAction
    askedAtStep: { type: Number, default: 0 },
    // External replies routed in from Telegram/WhatsApp; consumed by /pending-reply
    lastTelegramReply: { type: String, default: '' },
    lastWhatsAppReply: { type: String, default: '' }
  },
  // Execution state
  currentStepNumber: {
    type: Number,
    default: 0
  },
  steps: [agentStepSchema],
  trackedTabs: [trackedTabSchema],
  // Stored data (key-value pairs the agent accumulates)
  storedData: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // Context passed to LLM each iteration
  activeTabIndex: {
    type: Number,
    default: 0
  },
  // Completion info
  summary: {
    type: String,
    default: ''
  },
  errorMessage: {
    type: String,
    default: ''
  },
  // Credits & model tracking
  totalCreditsUsed: {
    type: Number,
    default: 0
  },
  modelUsed: {
    type: String,
    default: ''
  },
  // Limits
  maxSteps: {
    type: Number,
    default: 50 // Safety limit
  },
  // Origin platform of this task (so completion / failure / awaiting-user
  // notifications get routed back to the same channel the user used).
  source: {
    type: String,
    enum: ['web', 'telegram', 'whatsapp'],
    default: 'web',
    index: true
  },
  // Conversation link (optional)
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    default: null
  },
  // Free-form conversational messages the user sent via chat (Telegram /
  // WhatsApp) while this task was running but NOT awaiting a formal reply.
  // Consumed by `planNextAction` on the next /step round and cleared.
  chatNudges: [{
    source: { type: String, enum: ['telegram', 'whatsapp', 'web'], default: 'telegram' },
    text: { type: String, default: '' },
    at: { type: Date, default: Date.now }
  }],
  // Set once when a dormancy notice has been pushed to the user so we don't
  // spam them every sweep tick. Reset when the task progresses.
  dormancyNoticeSentAt: { type: Date, default: null },

  // ============================================
  // Screenshot state — short-lived OBS objects the agent has captured this
  // task. Deleted from OBS after a few minutes; we keep the pre-signed URL
  // of the MOST RECENT one so the next /step round can feed it to a
  // vision-capable LLM. `count` enforces the per-task cap from agentTiers.
  // ============================================
  screenshotsUsed: {
    count: { type: Number, default: 0 },
    lastObjectKey: { type: String, default: '' },
    lastSignedUrl: { type: String, default: '' },
    lastCapturedAt: { type: Date, default: null },
    lastExpiresAt: { type: Date, default: null }
  },

  // ============================================
  // Page-state diffing cache — populated from the client's readPage
  // contentHash. Used server-side to collapse repeated reads of the same
  // page into a tiny "unchanged" marker instead of re-sending the full
  // DOM to the LLM. Big token saver on multi-step flows.
  // ============================================
  lastReadPageFingerprint: {
    hash: { type: String, default: '' },
    url: { type: String, default: '' },
    stepNumber: { type: Number, default: 0 },
    // Compact interactive-surface snapshot used to compute deltas when the
    // hash changes. Capped at ~4KB on the client.
    signature: { type: String, default: '' },
    // Element counts \u2014 used as a collision guard: if the hash matches
    // but counts differ, we distrust the match and treat the page as
    // changed (prevents rare FNV-1a 32-bit false positives).
    counts: {
      buttons: { type: Number, default: 0 },
      links: { type: Number, default: 0 },
      inputs: { type: Number, default: 0 },
      headings: { type: Number, default: 0 }
    },
    // Tiny "what was on the page" digest used to preserve agent awareness
    // when we collapse a repeat read into a marker. Without this, the
    // agent would be told "page unchanged since step N" but the history
    // window no longer contains what step N actually saw.
    recall: {
      title: { type: String, default: '' },
      headings: { type: [String], default: [] },
      buttons:  { type: [String], default: [] },
      inputs:   { type: [String], default: [] }
    },
    capturedAt: { type: Date, default: null }
  },

  // ============================================
  // Diffing telemetry \u2014 observable proof the feature is working.
  // Read from the task detail endpoint / admin UI.
  // ============================================
  diffStats: {
    collapsedReads: { type: Number, default: 0 },
    bytesSaved: { type: Number, default: 0 },
    diffsEmitted: { type: Number, default: 0 }
  },

  // ============================================
  // Captured files \u2014 the agent can pull a URL from the user's live
  // browser session (with cookies) and pipe it to OBS for durable
  // storage. These files can then be chained into uploadFile / fillPdf /
  // notifyUser attachments / readFile, without ever touching local disk.
  // Stored per-task so the user UI can render a list of "files this task
  // produced".
  // ============================================
  // ============================================
  // Goal ledger \u2014 persistent milestone tracker. The agent sets milestones
  // at the start of a non-trivial task (\`setMilestones\`), marks them done
  // as it progresses (\`completeMilestone\`), and adds new ones if the
  // plan evolves (\`addMilestone\`). Surfaced in the prompt so long tasks
  // do not lose their place after context truncation.
  // ============================================
  goalLedger: {
    milestones: [{
      _id: false,
      id: { type: String, required: true },          // "m1" | short slug
      text: { type: String, default: '' },
      status: { type: String, enum: ['pending', 'in_progress', 'done', 'skipped'], default: 'pending' },
      evidence: { type: String, default: '' },        // short "how I know it's done" note
      completedAt: { type: Date, default: null },
      completedAtStep: { type: Number, default: 0 }
    }],
    currentMilestoneId: { type: String, default: '' },
    lastCritiqueStep: { type: Number, default: 0 },
    stuckScore: { type: Number, default: 0 }          // increments on semantic loops / repeated fails; reset on progress
  },

  // ============================================
  // Task type — classified by the planner. Used to gate /done on research
  // tasks (must have ≥2 distinct-domain sources), to inject a research
  // state block into the per-step prompt, and to scale the step budget.
  // ============================================
  taskType: {
    type: String,
    enum: ['research', 'action', 'mixed'],
    default: 'action',
    index: true
  },

  // ============================================
  // Research notes — structured per-claim evidence the agent accumulates
  // via the `researchNote` action. Surfaced every step so the agent can
  // cross-reference, and tallied server-side so `done` can be blocked
  // when a research task has fewer than N distinct source domains.
  // ============================================
  researchNotes: [{
    _id: false,
    id: { type: String, required: true },                        // "rn_<hex>"
    claim: { type: String, default: '' },                        // what the source says
    source: { type: String, default: '' },                       // full URL
    sourceDomain: { type: String, default: '' },                 // derived, for dedup
    sourceTier: { type: Number, min: 1, max: 4, default: 3 },    // 1=primary … 4=AI-snippet
    confidence: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    topic: { type: String, default: '' },                        // optional bucket
    note: { type: String, default: '' },                         // agent's own annotation
    publishedDate: { type: String, default: '' },                // as-seen on page (free text)
    recordedAtStep: { type: Number, default: 0 },
    recordedAt: { type: Date, default: Date.now },

    // Server-side verification — when researchPreferences.verifySources is
    // on, the server fetches the URL and checks whether the recorded claim
    // is actually present in the page text. Surfaced in RESEARCH STATE so
    // the agent (and the reviewing user) sees suspicious citations.
    verified: {
      type: String,
      enum: ['unverified', 'verified', 'partial', 'not_found', 'fetch_failed'],
      default: 'unverified'
    },
    verifyDetail: { type: String, default: '' }                  // short human-readable note (HTTP status, missing keywords, etc.)
  }],

  capturedFiles: [{
    _id: false,
    id: { type: String, required: true },       // "cap_<random>", stable ref
    filename: { type: String, default: '' },
    mime: { type: String, default: '' },
    size: { type: Number, default: 0 },
    objectKey: { type: String, required: true }, // OBS path
    signedUrl: { type: String, default: '' },    // fresh on insert; refreshable
    signedUrlExpiresAt: { type: Date, default: null },
    sourceUrl: { type: String, default: '' },    // URL the agent captured from
    description: { type: String, default: '' },
    capturedAt: { type: Date, default: Date.now },
    capturedAtStep: { type: Number, default: 0 }
  }]
}, { timestamps: true });

// Index for listing tasks by user, sorted by recent
agentTaskSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AgentTask', agentTaskSchema);

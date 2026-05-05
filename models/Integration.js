// User integrations + Agent preferences
// One document per user. Stores Telegram bot link, WhatsApp Web setup,
// and a set of agent behaviour preferences.

const mongoose = require('mongoose');

const IntegrationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },

  // ============================================
  // Telegram Bot
  // ============================================
  telegram: {
    enabled: { type: Boolean, default: false },
    // Bot token from @BotFather. ENCRYPTED at rest using services/cryptoService.
    // Format: "enc:v1:<iv>:<authTag>:<ciphertext>". Always decrypt() before use.
    botToken: { type: String, default: '' },
    // The numeric prefix of the bot token (e.g. "123456789" from "123456789:AAH...").
    // This is *not* a secret — it's part of the bot's public identity. Stored
    // separately so the public webhook can locate the right user without having
    // to decrypt every token in the database.
    botId: { type: String, default: '', index: true },
    // Numeric chat id once the user runs /link <code> from their bot
    chatId: { type: String, default: '' },
    // One-time linking code; user sends "/link <code>" to the bot to bind chatId
    linkCode: { type: String, default: '' },
    linkedAt: { type: Date, default: null },
    botUsername: { type: String, default: '' },
    // Last unprocessed task prompt sent via Telegram; polled by extension /inbox.
    queuedTaskPrompt: { type: String, default: '' }
  },

  // ============================================
  // WhatsApp (Option C — agent drives WhatsApp Web)
  // ============================================
  whatsapp: {
    enabled: { type: Boolean, default: false },
    // The user creates a WhatsApp group called this and adds only themselves.
    // The watcher only triggers on messages in this group.
    groupName: { type: String, default: 'My Agent' },
    // Last-seen message id we already processed (prevents re-triggering)
    lastSeenMessageId: { type: String, default: '' },
    linkedAt: { type: Date, default: null },
    // True once the content-script reports it found the group + handshake succeeded
    verified: { type: Boolean, default: false },
    // Last unprocessed task prompt sent via WhatsApp; polled by extension /inbox.
    queuedTaskPrompt: { type: String, default: '' }
  },

  // ============================================
  // Agent Behaviour Preferences
  // (read by /api/agent/plan and /api/agent/step to influence behaviour)
  // ============================================
  // Tracks the last queued task prompt that the extension drained from
  // /inbox, so /api/agent/plan + /api/agent/start can attribute the new
  // AgentTask to the originating platform (telegram / whatsapp) and route
  // its replies back to that same channel.
  lastInboxConsumed: {
    source: { type: String, enum: ['telegram', 'whatsapp', ''], default: '' },
    prompt: { type: String, default: '' },
    at: { type: Date, default: null }
  },

  preferences: {
    // Tab management
    canCloseTabs: { type: Boolean, default: true },
    autoCloseExceedingLimit: { type: Boolean, default: true },
    preferCurrentTab: { type: Boolean, default: true },  // prefer goto over openTab when possible
    // Notifications
    notifyChannel: { type: String, enum: ['none', 'telegram', 'whatsapp'], default: 'none' },
    notifyOnComplete: { type: Boolean, default: true },
    notifyOnAwaitingUser: { type: Boolean, default: true },
    notifyOnFailure: { type: Boolean, default: true },
    // Default agent mode used when a task is started from Telegram/WhatsApp
    // (or when the extension does not specify one). Toggle via /copilot,
    // /autopilot in the chat bot.
    defaultMode: { type: String, enum: ['copilot', 'autopilot'], default: 'copilot' },
    // User-preferred agent model id (matches AIModel.modelId). Set via /model
    // in the chat bot. Empty string means "use the system default".
    preferredAgentModelId: { type: String, default: '' },
    // Behaviour
    autoConfirmLowRisk: { type: Boolean, default: false },
    verboseLogging: { type: Boolean, default: false },

    // ============================================
    // Research depth — drives the `done`-gate AND the per-step prompt
    // hints for `research` / `mixed` tasks. The user controls how thorough
    // the agent is; higher values cost more steps but yield better-
    // corroborated answers.
    //
    // All values are CLAMPED on the server in routes/integrations.js so
    // a client cannot send absurd numbers and explode the step budget.
    // ============================================
    research: {
      // Minimum DISTINCT source domains required before the runtime will
      // accept `done` on a research/mixed task. 1 = no gate (allow single-
      // source answers), 2 = the previous hard-coded floor, 3+ = enforce
      // 3×N corroboration. Clamp: 1..6.
      minDistinctDomains: { type: Number, default: 2, min: 1, max: 6 },

      // SERP pagination: how many search-result pages the agent should
      // fetch with `webSearch` before settling on its candidate sources.
      // The agent decides WHICH page; this just sets the ceiling. Clamp: 1..5.
      maxSearchPages: { type: Number, default: 1, min: 1, max: 5 },

      // Minimum number of distinct websites the agent should OPEN (via
      // `goto` / `openTab`) before recording final claims. Surfaced in
      // the prompt so the agent plans for it. Clamp: 1..6.
      minWebsitesToVisit: { type: Number, default: 2, min: 1, max: 6 },

      // Max links the agent should click within a single visited site
      // (deeper navigation for richer evidence — e.g. clicking from a
      // homepage into an "About" or "Press" sub-page). Clamp: 0..6.
      maxLinksPerWebsite: { type: Number, default: 1, min: 0, max: 6 },

      // Max paginated result pages the agent should walk WITHIN a single
      // visited site (e.g. "next page" of a listing/forum). Clamp: 0..10.
      maxPaginatedPages: { type: Number, default: 1, min: 0, max: 10 },

      // Number of scroll passes the agent should perform when reading a
      // page that lazy-loads content. 0 = no extra scrolling beyond the
      // viewport. Clamp: 0..10.
      scrollPasses: { type: Number, default: 1, min: 0, max: 10 },

      // When true, the server fetches every `researchNote.source` URL
      // and attempts to confirm the recorded claim's key terms appear in
      // the page text. Adds ~1s of latency per note but catches
      // hallucinated citations. The agent sees the verification result
      // in RESEARCH STATE on subsequent steps.
      verifySources: { type: Boolean, default: true }
    }
  }
}, {
  timestamps: true
});

IntegrationSchema.statics.getOrCreate = async function (userId) {
  let doc = await this.findOne({ userId });
  if (!doc) doc = await this.create({ userId });
  return doc;
};

module.exports = mongoose.model('Integration', IntegrationSchema);

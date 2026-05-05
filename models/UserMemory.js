// Global Executive — User Memory Model
// Long-term facts about the user the agent should remember across sessions.
// Auto-extracted from task transcripts (see services/memoryService.js) and
// injected into every new task's briefing + agent system prompt.
//
// SECURITY:
//  - We DO NOT auto-save passwords, card numbers, or OTPs. The memory
//    extractor is prompted to strip those. Manual entries via the UI are
//    also filtered before save.
//  - Emails, addresses, preferences, account-handles, timezones, etc. ARE
//    fine to remember.
//  - If the agent itself created an account it may save the resulting
//    credentials (flagged `kind: 'credential'` + `createdByAgent: true`).

const mongoose = require('mongoose');

const userMemorySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Broad category to help the agent filter relevant memories
  category: {
    type: String,
    enum: [
      'preference',     // "I prefer window seats", "vegetarian meals"
      'account',        // "my primary Gmail is x@y.com"
      'identity',       // name, DOB, timezone, address (non-sensitive parts)
      'payment',        // "always use Chase ending 1234" (never the number)
      'habit',          // "I usually order from Amazon Tuesdays"
      'contact',        // "my partner's email is..."
      'rule',           // "never post publicly without asking"
      'credential',     // agent-created account (email + password)
      'other'
    ],
    default: 'other',
    index: true
  },
  // Short, first-person factual statement. E.g. "Prefers vegetarian meals."
  // The agent injects these as-is, so keep them concise and self-contained.
  text: {
    type: String,
    required: true,
    maxlength: 1000,
    trim: true
  },
  // Optional single-token key so the agent can reference a memory in prompts.
  // E.g. "preferred_email". Unique per user+key when set.
  key: {
    type: String,
    default: '',
    maxlength: 64,
    trim: true
  },
  // Optional structured value (for credentials, addresses, etc.)
  value: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  // Domain scoping — if set, this memory only applies on the given domain.
  // E.g. "amazon.com" for "delivery address is X". Empty = global.
  domain: {
    type: String,
    default: '',
    maxlength: 253,
    trim: true,
    lowercase: true,
    index: true
  },
  // Confidence 0-1 from the extractor. Low-confidence memories are shown
  // to the user for confirmation in the UI before being auto-used.
  confidence: { type: Number, default: 1, min: 0, max: 1 },
  // Did the agent create this (vs. user typing it in the UI)?
  createdByAgent: { type: Boolean, default: false },
  // Reference back to the task that produced it, if any.
  sourceTaskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AgentTask',
    default: null
  },
  // User-visible verification state. Memories extracted with confidence<0.8
  // default to 'pending' and are NOT injected until the user confirms.
  status: {
    type: String,
    enum: ['active', 'pending', 'archived'],
    default: 'active',
    index: true
  },
  // Soft counters for ranking / pruning
  usedCount: { type: Number, default: 0 },
  lastUsedAt: { type: Date, default: null }
}, { timestamps: true });

userMemorySchema.index({ userId: 1, status: 1, category: 1 });
userMemorySchema.index({ userId: 1, domain: 1, status: 1 });
userMemorySchema.index({ userId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $gt: '' } } });

module.exports = mongoose.model('UserMemory', userMemorySchema);

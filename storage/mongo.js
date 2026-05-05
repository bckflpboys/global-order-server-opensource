// MongoDB backend (optional). Requires MONGODB_URI env var.
// Uses mongoose. Documents are returned as plain objects with `_id` as a string.

const mongoose = require('mongoose');
const defaultModels = require('./default-models');

// ---------- Schemas ----------
const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, default: '' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    plan: { type: String, default: 'unlimited' },
    credits: { type: Number, default: 999999 },
    totalCreditsPurchased: { type: Number, default: 0 },
    totalCreditsUsed: { type: Number, default: 0 },
    aiRequestsUsed: { type: Number, default: 0 },
    isSuspended: { type: Boolean, default: false },
    lastLogin: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const toolSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '🔧' },
    targetSites: { type: [String], default: [] },
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active' },
    contentScript: { type: String, default: '' },
    styles: { type: String, default: '' },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    storageSchema: { type: mongoose.Schema.Types.Mixed, default: {} },
    dashboardHTML: { type: String, default: '' },
    originalPrompt: { type: String, default: '' },
    modelUsed: { type: String, default: '' },
    chatHistory: [
      { role: String, content: String, timestamps: { type: Date, default: Date.now } }
    ],
    version: { type: Number, default: 1 }
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    creditsUsed: { type: Number, default: 0 },
    model: { type: String, default: '' },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, default: 'New Conversation' },
    totalCreditsUsed: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    modelUsed: { type: String, default: '' },
    toolId: { type: String, default: null },
    toolName: { type: String, default: '' },
    status: { type: String, enum: ['active', 'completed', 'archived'], default: 'active' },
    messages: [messageSchema]
  },
  { timestamps: true }
);

// ---------- Additional Schemas ----------
const agentSettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  maxSteps: { type: Number, default: 0 },
  maxScreenshotsPerTask: { type: Number, default: 0 },
  maxScreenshotsPerStep: { type: Number, default: 0 },
  screenshotPolicy: { type: mongoose.Schema.Types.Mixed, default: {} },
  temperature: { type: Number, default: null },
  customRules: { type: String, default: '' },
  memoryEnabled: { type: Boolean, default: true },
  autoExtractMemories: { type: Boolean, default: true },
  councilRoles: { type: mongoose.Schema.Types.Mixed, default: {} },
  maxSubAgents: { type: Number, default: 3 },
  sessionPersistenceEnabled: { type: Boolean, default: false }
}, { timestamps: true });

const agentStepSchema = new mongoose.Schema({
  stepNumber: Number, thought: String, action: String, params: mongoose.Schema.Types.Mixed,
  expectation: String, result: mongoose.Schema.Types.Mixed, error: String,
  status: { type: String, enum: ['pending','executing','completed','failed','skipped'], default: 'pending' },
  creditsUsed: { type: Number, default: 0 }, model: String, inputTokens: { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 }, duration: { type: Number, default: 0 }, timestamp: { type: Date, default: Date.now }
}, { _id: false });

const agentTaskSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, default: 'New Task' },
  originalPrompt: { type: String, required: true },
  status: { type: String, enum: ['pending','planning','briefing','running','awaiting_user','paused','completed','failed','cancelled'], default: 'pending', index: true },
  mode: { type: String, enum: ['copilot','autopilot','subagents'], default: 'copilot', index: true },
  scheduledTaskId: { type: String, default: null },
  parentTaskId: { type: String, default: null, index: true },
  resumedFromId: { type: String, default: null },
  triggeredBy: { type: String, enum: ['user','schedule','subagent','resume'], default: 'user' },
  plan: { type: mongoose.Schema.Types.Mixed, default: {} },
  requiredInputs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  briefing: { type: mongoose.Schema.Types.Mixed, default: {} },
  permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  pendingQuestion: { type: mongoose.Schema.Types.Mixed, default: {} },
  currentStepNumber: { type: Number, default: 0 },
  steps: [agentStepSchema],
  trackedTabs: { type: [mongoose.Schema.Types.Mixed], default: [] },
  storedData: { type: mongoose.Schema.Types.Mixed, default: {} },
  activeTabIndex: { type: Number, default: 0 },
  summary: { type: String, default: '' },
  errorMessage: { type: String, default: '' },
  totalCreditsUsed: { type: Number, default: 0 },
  modelUsed: { type: String, default: '' },
  maxSteps: { type: Number, default: 50 },
  source: { type: String, enum: ['web','telegram','whatsapp'], default: 'web', index: true },
  conversationId: { type: String, default: null },
  chatNudges: { type: [mongoose.Schema.Types.Mixed], default: [] },
  dormancyNoticeSentAt: { type: Date, default: null },
  screenshotsUsed: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastReadPageFingerprint: { type: mongoose.Schema.Types.Mixed, default: {} },
  diffStats: { type: mongoose.Schema.Types.Mixed, default: {} },
  goalLedger: { type: mongoose.Schema.Types.Mixed, default: {} },
  taskType: { type: String, enum: ['research','action','mixed'], default: 'action', index: true },
  researchNotes: { type: [mongoose.Schema.Types.Mixed], default: [] },
  capturedFiles: { type: [mongoose.Schema.Types.Mixed], default: [] }
}, { timestamps: true });
agentTaskSchema.index({ userId: 1, createdAt: -1 });

const domainRuleSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  domain: { type: String, required: true, lowercase: true, trim: true },
  rule: { type: String, required: true, trim: true },
  severity: { type: String, enum: ['must','should','info'], default: 'must' },
  enabled: { type: Boolean, default: true }
}, { timestamps: true });
domainRuleSchema.index({ userId: 1, domain: 1, enabled: 1 });

const integrationSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  telegram: { type: mongoose.Schema.Types.Mixed, default: {} },
  whatsapp: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastInboxConsumed: { type: mongoose.Schema.Types.Mixed, default: {} },
  preferences: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const onboardingSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  tosAccepted: { type: Boolean, default: false },
  tosAcceptedAt: { type: Date, default: null },
  privacyAccepted: { type: Boolean, default: false },
  privacyAcceptedAt: { type: Date, default: null },
  whereDidYouHearAboutUs: { type: String, default: null },
  whereDidYouHearAboutUsOther: { type: String, default: '' },
  intendedFeatures: { type: [String], default: [] },
  intendedFeaturesOther: { type: String, default: '' },
  completed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  currentStep: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const scheduledTaskSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  prompt: { type: String, required: true, trim: true },
  mode: { type: String, enum: ['copilot','autopilot'], default: 'autopilot' },
  briefing: { type: mongoose.Schema.Types.Mixed, default: {} },
  permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
  cron: { type: String, required: true, trim: true },
  timezone: { type: String, default: 'UTC' },
  enabled: { type: Boolean, default: true, index: true },
  nextRunAt: { type: Date, default: null, index: true },
  lastRunAt: { type: Date, default: null },
  lastTaskId: { type: String, default: null },
  lastRunStatus: { type: String, enum: ['never','success','failed','cancelled'], default: 'never' },
  lastRunError: { type: String, default: '' },
  runCount: { type: Number, default: 0 },
  modelId: { type: String, default: '' },
  source: { type: String, enum: ['web','telegram','whatsapp'], default: 'web' }
}, { timestamps: true });
scheduledTaskSchema.index({ userId: 1, enabled: 1, nextRunAt: 1 });

const userMemorySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  category: { type: String, default: 'other', index: true },
  text: { type: String, required: true, trim: true },
  key: { type: String, default: '', trim: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  domain: { type: String, default: '', lowercase: true, trim: true, index: true },
  confidence: { type: Number, default: 1, min: 0, max: 1 },
  createdByAgent: { type: Boolean, default: false },
  sourceTaskId: { type: String, default: null },
  status: { type: String, enum: ['active','pending','archived'], default: 'active', index: true },
  usedCount: { type: Number, default: 0 },
  lastUsedAt: { type: Date, default: null }
}, { timestamps: true });
userMemorySchema.index({ userId: 1, status: 1, category: 1 });
userMemorySchema.index({ userId: 1, domain: 1, status: 1 });

const User = mongoose.model('User', userSchema);
const Tool = mongoose.model('Tool', toolSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);
const AgentSettings = mongoose.model('AgentSettings', agentSettingsSchema);
const AgentTask = mongoose.model('AgentTask', agentTaskSchema);
const DomainRule = mongoose.model('DomainRule', domainRuleSchema);
const Integration = mongoose.model('Integration', integrationSchema);
const Onboarding = mongoose.model('Onboarding', onboardingSchema);
const ScheduledTask = mongoose.model('ScheduledTask', scheduledTaskSchema);
const UserMemory = mongoose.model('UserMemory', userMemorySchema);

// ---------- helpers ----------
function plain(doc) {
  if (!doc) return null;
  const o = doc.toObject ? doc.toObject() : doc;
  o._id = String(o._id);
  return o;
}

const users = {
  async findById(id) {
    if (!id) return null;
    try {
      return plain(await User.findById(id));
    } catch {
      return null;
    }
  },
  async findByEmail(email) {
    return plain(await User.findOne({ email: (email || '').toLowerCase().trim() }));
  },
  async create(doc) {
    const u = await User.create({
      email: doc.email,
      passwordHash: doc.passwordHash,
      displayName: doc.displayName || ''
    });
    return plain(u);
  },
  async update(id, patch) {
    return plain(await User.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await User.deleteOne({ _id: id });
    return r.deletedCount > 0;
  }
};

const tools = {
  async findByUser(userId, status) {
    const q = { userId };
    if (status) q.status = status;
    const rows = await Tool.find(q).sort({ updatedAt: -1 }).lean();
    rows.forEach((r) => (r._id = String(r._id)));
    return rows;
  },
  async findOne(id, userId) {
    try {
      const q = { _id: id };
      if (userId) q.userId = userId;
      const t = await Tool.findOne(q).lean();
      if (t) t._id = String(t._id);
      return t;
    } catch {
      return null;
    }
  },
  async create(doc) {
    const t = await Tool.create(doc);
    return plain(t);
  },
  async update(id, patch) {
    return plain(await Tool.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await Tool.deleteOne({ _id: id });
    return r.deletedCount > 0;
  },
  async countByUser(userId) {
    return Tool.countDocuments({ userId });
  }
};

const conversations = {
  async findByUser(userId) {
    const rows = await Conversation.find({ userId }).sort({ updatedAt: -1 }).limit(50).lean();
    rows.forEach((r) => (r._id = String(r._id)));
    return rows;
  },
  async findOne(id, userId) {
    try {
      const q = { _id: id };
      if (userId) q.userId = userId;
      const c = await Conversation.findOne(q).lean();
      if (c) c._id = String(c._id);
      return c;
    } catch {
      return null;
    }
  },
  async create(doc) {
    const c = await Conversation.create(doc);
    return plain(c);
  },
  async update(id, patch) {
    return plain(await Conversation.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await Conversation.deleteOne({ _id: id });
    return r.deletedCount > 0;
  }
};

// Models are read from the static seed file — no admin UI to manage them.
const models = {
  async findEnabled() {
    return defaultModels
      .filter((m) => m.isEnabled)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },
  async findById(modelId) {
    return defaultModels.find((m) => m.modelId === modelId && m.isEnabled) || null;
  },
  async findDefault() {
    return (
      defaultModels.find((m) => m.isDefault && m.isEnabled) ||
      defaultModels.find((m) => m.isEnabled) ||
      null
    );
  },
  async list() {
    return defaultModels;
  }
};

// ---------- Agent Settings ----------
const agentSettings = {
  async findByUser(userId) {
    return plain(await AgentSettings.findOne({ userId: String(userId) }));
  },
  async getOrCreate(userId) {
    let doc = await AgentSettings.findOne({ userId: String(userId) });
    if (!doc) doc = await AgentSettings.create({ userId: String(userId) });
    return plain(doc);
  },
  async update(id, patch) {
    return plain(await AgentSettings.findByIdAndUpdate(id, patch, { new: true }));
  }
};

// ---------- Agent Tasks ----------
const agentTasks = {
  async findByUser(userId, opts = {}) {
    const q = { userId: String(userId) };
    if (opts.status) q.status = opts.status;
    if (opts.mode) q.mode = opts.mode;
    let query = AgentTask.find(q).sort({ createdAt: -1 });
    if (opts.limit) query = query.limit(opts.limit);
    const rows = await query.lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async findOne(id, userId) {
    try {
      const q = { _id: id };
      if (userId) q.userId = String(userId);
      const t = await AgentTask.findOne(q).lean();
      if (t) t._id = String(t._id);
      return t;
    } catch { return null; }
  },
  async create(doc) {
    const t = await AgentTask.create({ ...doc, userId: String(doc.userId) });
    return plain(t);
  },
  async update(id, patch) {
    return plain(await AgentTask.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await AgentTask.deleteOne({ _id: id });
    return r.deletedCount > 0;
  },
  async countByUser(userId) {
    return AgentTask.countDocuments({ userId: String(userId) });
  },
  async findPendingScheduled() {
    const rows = await AgentTask.find({ scheduledTaskId: { $ne: null }, status: 'pending' }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async findSubTasks(parentTaskId) {
    const rows = await AgentTask.find({ parentTaskId: String(parentTaskId) }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  }
};

// ---------- Domain Rules ----------
const domainRules = {
  async findByUser(userId) {
    const rows = await DomainRule.find({ userId: String(userId), enabled: { $ne: false } }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async findByDomain(userId, domain) {
    const rows = await DomainRule.find({ userId: String(userId), enabled: { $ne: false }, domain: { $in: [domain, '*'] } }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async create(doc) {
    const r = await DomainRule.create({ ...doc, userId: String(doc.userId), domain: (doc.domain || '').toLowerCase(), enabled: true });
    return plain(r);
  },
  async update(id, patch) {
    return plain(await DomainRule.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await DomainRule.deleteOne({ _id: id });
    return r.deletedCount > 0;
  },
  async countByUser(userId) {
    return DomainRule.countDocuments({ userId: String(userId) });
  }
};

// ---------- Integrations ----------
const integrations = {
  async findByUser(userId) {
    return plain(await Integration.findOne({ userId: String(userId) }));
  },
  async getOrCreate(userId) {
    let doc = await Integration.findOne({ userId: String(userId) });
    if (!doc) doc = await Integration.create({ userId: String(userId) });
    return plain(doc);
  },
  async update(id, patch) {
    return plain(await Integration.findByIdAndUpdate(id, patch, { new: true }));
  },
  async findByBotId(botId) {
    return plain(await Integration.findOne({ 'telegram.botId': String(botId) }));
  }
};

// ---------- Onboarding ----------
const onboarding = {
  async findByUser(userId) {
    return plain(await Onboarding.findOne({ userId: String(userId) }));
  },
  async getOrCreate(userId) {
    let doc = await Onboarding.findOne({ userId: String(userId) });
    if (!doc) doc = await Onboarding.create({ userId: String(userId) });
    return plain(doc);
  },
  async update(id, patch) {
    return plain(await Onboarding.findByIdAndUpdate(id, patch, { new: true }));
  }
};

// ---------- Scheduled Tasks ----------
const scheduledTasks = {
  async findByUser(userId) {
    const rows = await ScheduledTask.find({ userId: String(userId) }).sort({ createdAt: -1 }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async findOne(id, userId) {
    try {
      const q = { _id: id };
      if (userId) q.userId = String(userId);
      const t = await ScheduledTask.findOne(q).lean();
      if (t) t._id = String(t._id);
      return t;
    } catch { return null; }
  },
  async findEnabled() {
    const rows = await ScheduledTask.find({ enabled: true }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async findDue() {
    const rows = await ScheduledTask.find({ enabled: true, nextRunAt: { $lte: new Date() } }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async create(doc) {
    const t = await ScheduledTask.create({ ...doc, userId: String(doc.userId) });
    return plain(t);
  },
  async update(id, patch) {
    return plain(await ScheduledTask.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await ScheduledTask.deleteOne({ _id: id });
    return r.deletedCount > 0;
  },
  async countByUser(userId) {
    return ScheduledTask.countDocuments({ userId: String(userId) });
  }
};

// ---------- User Memory ----------
const userMemory = {
  async findByUser(userId, opts = {}) {
    const q = { userId: String(userId) };
    if (opts.status) q.status = opts.status;
    else q.status = 'active';
    if (opts.category) q.category = opts.category;
    if (opts.domain) q.domain = { $in: [opts.domain, ''] };
    const rows = await UserMemory.find(q).sort({ updatedAt: -1 }).lean();
    rows.forEach(r => (r._id = String(r._id)));
    return rows;
  },
  async findOne(id, userId) {
    try {
      const q = { _id: id };
      if (userId) q.userId = String(userId);
      const m = await UserMemory.findOne(q).lean();
      if (m) m._id = String(m._id);
      return m;
    } catch { return null; }
  },
  async create(doc) {
    const m = await UserMemory.create({ ...doc, userId: String(doc.userId) });
    return plain(m);
  },
  async update(id, patch) {
    return plain(await UserMemory.findByIdAndUpdate(id, patch, { new: true }));
  },
  async delete(id) {
    const r = await UserMemory.deleteOne({ _id: id });
    return r.deletedCount > 0;
  },
  async countByUser(userId, status) {
    const q = { userId: String(userId) };
    if (status) q.status = status;
    return UserMemory.countDocuments(q);
  },
  async findByKey(userId, key) {
    return plain(await UserMemory.findOne({ userId: String(userId), key, status: 'active' }));
  }
};

async function connect() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required when STORAGE=mongodb');
  }
  await mongoose.connect(uri);
  console.log('[storage] connected to MongoDB');
}

module.exports = { backend: 'mongodb', connect, users, tools, conversations, models, agentSettings, agentTasks, domainRules, integrations, onboarding, scheduledTasks, userMemory };

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

const User = mongoose.model('User', userSchema);
const Tool = mongoose.model('Tool', toolSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

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

module.exports = { backend: 'mongodb', connect, users, tools, conversations, models };

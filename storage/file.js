// File-based JSON storage — zero external DB required.
// All data lives in DATA_DIR (default: ./data) as plain JSON files
// you can inspect, back up, or delete with normal tools.
//
// Each "collection" is an array of documents persisted to its own file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getModels } = require('./env-models');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name) {
  ensureDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`[storage] Could not parse ${p}:`, e.message);
    return [];
  }
}

function save(name, rows) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(rows, null, 2));
}

function newId() {
  // 24-char hex, mimics MongoDB ObjectId formatting
  return crypto.randomBytes(12).toString('hex');
}

// ---------- generic helpers ----------
function makeCollection(name) {
  return {
    all: () => load(name),
    write: (rows) => save(name, rows),
    findById(id) {
      return load(name).find((d) => d._id === id) || null;
    },
    insert(doc) {
      const rows = load(name);
      const now = new Date().toISOString();
      const full = { _id: newId(), createdAt: now, updatedAt: now, ...doc };
      rows.push(full);
      save(name, rows);
      return full;
    },
    update(id, patch) {
      const rows = load(name);
      const i = rows.findIndex((d) => d._id === id);
      if (i === -1) return null;
      rows[i] = { ...rows[i], ...patch, updatedAt: new Date().toISOString() };
      save(name, rows);
      return rows[i];
    },
    remove(id) {
      const rows = load(name);
      const next = rows.filter((d) => d._id !== id);
      const removed = rows.length !== next.length;
      if (removed) save(name, next);
      return removed;
    }
  };
}

const usersCol = makeCollection('users');
const toolsCol = makeCollection('tools');
const convosCol = makeCollection('conversations');
const agentSettingsCol = makeCollection('agentSettings');
const agentTasksCol = makeCollection('agentTasks');
const domainRulesCol = makeCollection('domainRules');
const integrationsCol = makeCollection('integrations');
const onboardingCol = makeCollection('onboarding');
const scheduledTasksCol = makeCollection('scheduledTasks');
const userMemoryCol = makeCollection('userMemory');

// ---------- public API ----------
const users = {
  findById: (id) => usersCol.findById(id),
  findByEmail(email) {
    const e = (email || '').toLowerCase().trim();
    return usersCol.all().find((u) => u.email === e) || null;
  },
  create(doc) {
    return usersCol.insert({
      email: (doc.email || '').toLowerCase().trim(),
      passwordHash: doc.passwordHash,
      displayName: doc.displayName || '',
      role: doc.role || 'user',
      plan: 'unlimited',
      credits: 999999,
      totalCreditsPurchased: 0,
      totalCreditsUsed: 0,
      aiRequestsUsed: 0,
      isSuspended: false,
      lastLogin: new Date().toISOString()
    });
  },
  update: (id, patch) => usersCol.update(id, patch),
  delete: (id) => usersCol.remove(id)
};

const tools = {
  findByUser(userId, status) {
    let rows = toolsCol.all().filter((t) => t.userId === userId);
    if (status) rows = rows.filter((t) => t.status === status);
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return rows;
  },
  findOne(id, userId) {
    const t = toolsCol.findById(id);
    if (!t) return null;
    if (userId && t.userId !== userId) return null;
    return t;
  },
  create: (doc) => toolsCol.insert(doc),
  update: (id, patch) => toolsCol.update(id, patch),
  delete: (id) => toolsCol.remove(id),
  countByUser: (userId) => toolsCol.all().filter((t) => t.userId === userId).length
};

const conversations = {
  findByUser(userId) {
    const rows = convosCol.all().filter((c) => c.userId === userId);
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return rows;
  },
  findOne(id, userId) {
    const c = convosCol.findById(id);
    if (!c) return null;
    if (userId && c.userId !== userId) return null;
    return c;
  },
  create: (doc) =>
    convosCol.insert({
      title: doc.title || 'New Conversation',
      modelUsed: doc.modelUsed || '',
      totalCreditsUsed: 0,
      messageCount: 0,
      messages: [],
      status: 'active',
      ...doc
    }),
  update: (id, patch) => convosCol.update(id, patch),
  delete: (id) => convosCol.remove(id)
};

const models = {
  findEnabled() {
    return getModels()
      .filter((m) => m.isEnabled)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },
  findById(modelId) {
    return getModels().find((m) => m.modelId === modelId && m.isEnabled) || null;
  },
  findDefault() {
    return (
      getModels().find((m) => m.isDefault && m.isEnabled) ||
      getModels().find((m) => m.isEnabled) ||
      null
    );
  },
  list() {
    return getModels();
  }
};

// ---------- Agent Settings ----------
const agentSettings = {
  findByUser(userId) {
    return agentSettingsCol.all().find((s) => s.userId === String(userId)) || null;
  },
  getOrCreate(userId) {
    let doc = agentSettingsCol.all().find((s) => s.userId === String(userId));
    if (!doc) {
      doc = agentSettingsCol.insert({
        userId: String(userId),
        maxSteps: 0,
        maxScreenshotsPerTask: 0,
        maxScreenshotsPerStep: 0,
        screenshotPolicy: { onTaskStart: false, everyNSteps: 0, beforeInteraction: false, afterNavigation: false, onError: false, onCanvasHeavy: true },
        temperature: null,
        customRules: '',
        memoryEnabled: true,
        autoExtractMemories: true,
        councilRoles: { strategist: '', executor: '', critic: '', optimizer: '' },
        maxSubAgents: 3,
        sessionPersistenceEnabled: false
      });
    }
    return doc;
  },
  update: (id, patch) => agentSettingsCol.update(id, patch)
};

// ---------- Agent Tasks ----------
const agentTasks = {
  findByUser(userId, opts = {}) {
    let rows = agentTasksCol.all().filter((t) => t.userId === String(userId));
    if (opts.status) rows = rows.filter((t) => t.status === opts.status);
    if (opts.mode) rows = rows.filter((t) => t.mode === opts.mode);
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  },
  findOne(id, userId) {
    const t = agentTasksCol.findById(id);
    if (!t) return null;
    if (userId && t.userId !== String(userId)) return null;
    return t;
  },
  create: (doc) => agentTasksCol.insert({ ...doc, userId: String(doc.userId) }),
  update: (id, patch) => agentTasksCol.update(id, patch),
  delete: (id) => agentTasksCol.remove(id),
  countByUser: (userId) => agentTasksCol.all().filter((t) => t.userId === String(userId)).length,
  findPendingScheduled: () => agentTasksCol.all().filter((t) => t.scheduledTaskId && t.status === 'pending'),
  findSubTasks: (parentTaskId) => agentTasksCol.all().filter((t) => t.parentTaskId === String(parentTaskId))
};

// ---------- Domain Rules ----------
const domainRules = {
  findByUser(userId) {
    return domainRulesCol.all().filter((r) => r.userId === String(userId) && r.enabled !== false);
  },
  findByDomain(userId, domain) {
    return domainRulesCol.all().filter((r) => r.userId === String(userId) && r.enabled !== false && (r.domain === domain || r.domain === '*'));
  },
  create: (doc) => domainRulesCol.insert({ ...doc, userId: String(doc.userId), domain: (doc.domain || '').toLowerCase(), enabled: true }),
  update: (id, patch) => domainRulesCol.update(id, patch),
  delete: (id) => domainRulesCol.remove(id),
  countByUser: (userId) => domainRulesCol.all().filter((r) => r.userId === String(userId)).length
};

// ---------- Integrations ----------
const integrations = {
  findByUser(userId) {
    return integrationsCol.all().find((i) => i.userId === String(userId)) || null;
  },
  getOrCreate(userId) {
    let doc = integrationsCol.all().find((i) => i.userId === String(userId));
    if (!doc) {
      doc = integrationsCol.insert({
        userId: String(userId),
        telegram: { enabled: false, botToken: '', botId: '', chatId: '', linkCode: '', linkedAt: null, botUsername: '', queuedTaskPrompt: '' },
        whatsapp: { enabled: false, groupName: 'My Agent', lastSeenMessageId: '', linkedAt: null, verified: false, queuedTaskPrompt: '' },
        lastInboxConsumed: { source: '', prompt: '', at: null },
        preferences: {
          canCloseTabs: true, autoCloseExceedingLimit: true, preferCurrentTab: true,
          notifyChannel: 'none', notifyOnComplete: true, notifyOnAwaitingUser: true, notifyOnFailure: true,
          defaultMode: 'copilot', preferredAgentModelId: '',
          autoConfirmLowRisk: false, verboseLogging: false,
          research: { minDistinctDomains: 2, maxSearchPages: 1, minWebsitesToVisit: 2, maxLinksPerWebsite: 1, maxPaginatedPages: 1, scrollPasses: 1, verifySources: true }
        }
      });
    }
    return doc;
  },
  update: (id, patch) => integrationsCol.update(id, patch),
  findByBotId: (botId) => integrationsCol.all().find((i) => i.telegram?.botId === String(botId)) || null
};

// ---------- Onboarding ----------
const onboarding = {
  findByUser(userId) {
    return onboardingCol.all().find((o) => o.userId === String(userId)) || null;
  },
  getOrCreate(userId) {
    let doc = onboardingCol.all().find((o) => o.userId === String(userId));
    if (!doc) {
      doc = onboardingCol.insert({
        userId: String(userId),
        tosAccepted: false, tosAcceptedAt: null,
        privacyAccepted: false, privacyAcceptedAt: null,
        whereDidYouHearAboutUs: null, whereDidYouHearAboutUsOther: '',
        intendedFeatures: [], intendedFeaturesOther: '',
        completed: false, completedAt: null,
        currentStep: 0, startedAt: new Date().toISOString()
      });
    }
    return doc;
  },
  update: (id, patch) => onboardingCol.update(id, patch)
};

// ---------- Scheduled Tasks ----------
const scheduledTasks = {
  findByUser(userId) {
    const rows = scheduledTasksCol.all().filter((t) => t.userId === String(userId));
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return rows;
  },
  findOne(id, userId) {
    const t = scheduledTasksCol.findById(id);
    if (!t) return null;
    if (userId && t.userId !== String(userId)) return null;
    return t;
  },
  findEnabled() {
    return scheduledTasksCol.all().filter((t) => t.enabled);
  },
  findDue() {
    const now = new Date();
    return scheduledTasksCol.all().filter((t) => t.enabled && t.nextRunAt && new Date(t.nextRunAt) <= now);
  },
  create: (doc) => scheduledTasksCol.insert({ ...doc, userId: String(doc.userId), enabled: true, nextRunAt: null, lastRunAt: null, lastTaskId: null, lastRunStatus: 'never', lastRunError: '', runCount: 0 }),
  update: (id, patch) => scheduledTasksCol.update(id, patch),
  delete: (id) => scheduledTasksCol.remove(id),
  countByUser: (userId) => scheduledTasksCol.all().filter((t) => t.userId === String(userId)).length
};

// ---------- User Memory ----------
const userMemory = {
  findByUser(userId, opts = {}) {
    let rows = userMemoryCol.all().filter((m) => m.userId === String(userId));
    if (opts.status) rows = rows.filter((m) => m.status === opts.status);
    else rows = rows.filter((m) => m.status === 'active');
    if (opts.category) rows = rows.filter((m) => m.category === opts.category);
    if (opts.domain) rows = rows.filter((m) => m.domain === opts.domain || m.domain === '');
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return rows;
  },
  findOne(id, userId) {
    const m = userMemoryCol.findById(id);
    if (!m) return null;
    if (userId && m.userId !== String(userId)) return null;
    return m;
  },
  create: (doc) => userMemoryCol.insert({ ...doc, userId: String(doc.userId), status: doc.status || 'active', confidence: doc.confidence ?? 1, usedCount: 0, lastUsedAt: null }),
  update: (id, patch) => userMemoryCol.update(id, patch),
  delete: (id) => userMemoryCol.remove(id),
  countByUser: (userId, status) => userMemoryCol.all().filter((m) => m.userId === String(userId) && (!status || m.status === status)).length,
  findByKey: (userId, key) => userMemoryCol.all().find((m) => m.userId === String(userId) && m.key === key && m.status === 'active') || null
};

async function connect() {
  ensureDir();
  console.log(`[storage] file backend ready (DATA_DIR=${DATA_DIR})`);
}

module.exports = { backend: 'file', connect, users, tools, conversations, models, agentSettings, agentTasks, domainRules, integrations, onboarding, scheduledTasks, userMemory };

// File-based JSON storage — zero external DB required.
// All data lives in DATA_DIR (default: ./data) as plain JSON files
// you can inspect, back up, or delete with normal tools.
//
// Each "collection" is an array of documents persisted to its own file.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const defaultModels = require('./default-models');

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
  update: (id, patch) => usersCol.update(id, patch)
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
    return defaultModels
      .filter((m) => m.isEnabled)
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  },
  findById(modelId) {
    return defaultModels.find((m) => m.modelId === modelId && m.isEnabled) || null;
  },
  findDefault() {
    return (
      defaultModels.find((m) => m.isDefault && m.isEnabled) ||
      defaultModels.find((m) => m.isEnabled) ||
      null
    );
  }
};

async function connect() {
  ensureDir();
  console.log(`[storage] file backend ready (DATA_DIR=${DATA_DIR})`);
}

module.exports = { backend: 'file', connect, users, tools, conversations, models };

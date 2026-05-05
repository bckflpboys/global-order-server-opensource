// Storage adapter — picks file or mongo backend based on env.
//   STORAGE=file     (default)  — JSON file on disk, no DB needed
//   STORAGE=mongodb            — Mongoose + MongoDB Atlas / self-hosted
//
// Both backends expose the same shape:
//   db.users:         { findById, findByEmail, create, update, delete }
//   db.tools:         { findByUser, findOne, create, update, delete, countByUser }
//   db.conversations: { findByUser, findOne, create, update, delete }
//   db.models:        { findEnabled, findById, findDefault, list }
//   db.agentSettings: { findByUser, getOrCreate, update }
//   db.agentTasks:    { findByUser, findOne, create, update, delete, countByUser, findPendingScheduled, findSubTasks }
//   db.domainRules:   { findByUser, findByDomain, create, update, delete, countByUser }
//   db.integrations:  { findByUser, getOrCreate, update, findByBotId }
//   db.onboarding:    { findByUser, getOrCreate, update }
//   db.scheduledTasks:{ findByUser, findOne, findEnabled, findDue, create, update, delete, countByUser }
//   db.userMemory:    { findByUser, findOne, create, update, delete, countByUser, findByKey }
//   db.connect()      — initialise connection / load file
//
// Models are loaded from OPENROUTER_MODEL_* env vars (see env-models.js).
// If no env vars are set, falls back to default-models.js.
//
// Documents always include a string `_id` (so the extension code that
// references either `_id` or `id` works without modification).

const backend = (process.env.STORAGE || 'file').toLowerCase();

let impl;
if (backend === 'mongodb' || backend === 'mongo') {
  impl = require('./mongo');
} else {
  impl = require('./file');
}

module.exports = impl;

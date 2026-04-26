// Storage adapter — picks file or mongo backend based on env.
//   STORAGE=file     (default)  — JSON file on disk, no DB needed
//   STORAGE=mongodb            — Mongoose + MongoDB Atlas / self-hosted
//
// Both backends expose the same shape:
//   db.users:         { findById, findByEmail, create, update }
//   db.tools:         { findByUser, findById, create, update, delete }
//   db.conversations: { findByUser, findById, create, update, delete }
//   db.models:        { findEnabled, findById }   // read-only seed
//   db.connect()      — initialise connection / load file
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

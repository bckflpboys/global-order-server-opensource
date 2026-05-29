// Step-pattern mining service — Self-hosted version
// In the private server, this mines recurring action patterns from completed
// tasks and serves them as "hints" back to the agent. For self-hosted, we
// provide the same API surface but with no-op mining (patterns are not
// persisted across restarts in file-based storage). MongoDB users get
// basic in-memory pattern tracking.

const db = require('../storage');

// In-memory pattern store (lost on restart for file-based storage)
const patterns = new Map();

async function mineFromTask(task) {
  // No-op for self-hosted: pattern mining is a premium feature that
  // requires significant storage and processing. Self-hosted users
  // can implement their own mining logic if desired.
}

async function getHintsForDomain(domain) {
  // Return empty hints — no pattern mining for self-hosted
  return [];
}

async function getPatternStats() {
  return { totalPatterns: 0, domains: 0 };
}

module.exports = { mineFromTask, getHintsForDomain, getPatternStats };

// Skill matching service — Self-hosted version
// In the private server, this matches new tasks against previously-mined
// "skills" (procedural memory) and injects a "prior art" block into the
// agent prompt. For self-hosted, we provide the same API surface but
// with no-op matching (no global skill pool).

async function findMatch(prompt, domain) {
  // No skill matching for self-hosted — no global pool
  return null;
}

function buildPriorArtBlock(match) {
  // No prior art available
  return '';
}

async function getSkillStats() {
  return { totalSkills: 0, domains: 0 };
}

module.exports = { findMatch, buildPriorArtBlock, getSkillStats };

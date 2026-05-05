// Reads model definitions from OPENROUTER_MODEL_* env vars.
// If no OPENROUTER_MODEL_* vars are set, falls back to default-models.js.
//
// Env var format:
//   OPENROUTER_MODEL_{TIER}_{N}            = openrouter model id (e.g. google/gemini-2.5-flash)
//   OPENROUTER_MODEL_{TIER}_{N}_VISION     = true/false
//   OPENROUTER_MODEL_{TIER}_{N}_AGENT      = true/false
//   OPENROUTER_MODEL_{TIER}_{N}_VISION_AGENT = true/false
//
// TIER = FREE | STANDARD | PREMIUM
// N    = 1..10 (or more — the loader scans until it finds a blank slot)

const defaultModels = require('./default-models');

const TIERS = ['FREE', 'STANDARD', 'PREMIUM'];
const tierMap = { FREE: 'free', STANDARD: 'standard', PREMIUM: 'premium' };

function parseBool(val) {
  if (!val) return false;
  return val.toLowerCase() === 'true';
}

/**
 * Derive a human-readable name from an OpenRouter model id.
 * e.g. "google/gemini-2.5-flash" → "Gemini 2.5 Flash"
 */
function deriveName(openRouterId) {
  const parts = openRouterId.split('/');
  const raw = parts.length > 1 ? parts.slice(1).join('/') : openRouterId;
  // Replace hyphens/underscores with spaces, title-case words
  return raw
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Build a modelId suitable for internal use (no slashes).
 * e.g. "google/gemini-2.5-flash" → "gemini-2-5-flash"
 */
function deriveModelId(openRouterId) {
  const parts = openRouterId.split('/');
  const raw = parts.length > 1 ? parts[1] : openRouterId;
  return raw.replace(/\./g, '-').replace(/[^a-zA-Z0-9-]/g, '-');
}

function loadFromEnv() {
  const models = [];
  let sortOrder = 1;
  let hasAny = false;

  for (const tier of TIERS) {
    // Scan slots 1..100 (practical upper bound; users can add as many as they want)
    for (let n = 1; n <= 100; n++) {
      const key = `OPENROUTER_MODEL_${tier}_${n}`;
      const val = process.env[key];
      if (!val || !val.trim()) break; // stop at first blank slot

      hasAny = true;
      const openRouterId = val.trim();
      const visionKey     = `OPENROUTER_MODEL_${tier}_${n}_VISION`;
      const agentKey      = `OPENROUTER_MODEL_${tier}_${n}_AGENT`;
      const visionAgentKey = `OPENROUTER_MODEL_${tier}_${n}_VISION_AGENT`;

      const isVision      = parseBool(process.env[visionKey]);
      const isAgent       = parseBool(process.env[agentKey]);
      const isVisionAgent = parseBool(process.env[visionAgentKey]);

      models.push({
        _id: deriveModelId(openRouterId),
        modelId: deriveModelId(openRouterId),
        name: deriveName(openRouterId),
        openRouterId,
        tier: tierMap[tier],
        description: '',
        contextWindow: 128000,
        creditsPerInputToken: 0,
        creditsPerOutputToken: 0,
        isEnabled: true,
        isDefault: sortOrder === 1,
        isVisionModel: isVision || isVisionAgent,
        isAgentModel: isAgent || isVisionAgent,
        sortOrder
      });

      sortOrder++;
    }
  }

  return hasAny ? models : null;
}

/**
 * Returns the merged model list.
 * Priority: env vars → default-models.js fallback.
 * If env vars define at least one model, default-models.js is ignored.
 */
function getModels() {
  return loadFromEnv() || defaultModels;
}

module.exports = { getModels, loadFromEnv };

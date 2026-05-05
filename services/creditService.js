// Credit Service — Self-hosted version
// No credit deduction. All users have unlimited credits.
// Functions kept for API compatibility but are no-ops.

const db = require('../storage');

const MINIMUM_COST_FLOOR = 0;
const MAX_TOKENS_PER_REQUEST = 50000;

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

function calculateCreditCost(modelConfig, inputTokens, outputTokens) {
  return 0; // Self-hosted: no cost
}

function getEstimatedToolCost(modelConfig) {
  return 0;
}

async function hasEnoughCredits(userId, estimatedCost) {
  return true; // Always
}

async function deductCredits(userId, modelConfig, inputTokens, outputTokens, requestId = '') {
  return {
    cost: 0,
    remainingCredits: 999999,
    inputTokens: Math.floor(inputTokens || 0),
    outputTokens: Math.floor(outputTokens || 0)
  };
}

async function addCredits(userId, amount, source = 'manual', requestId = '') {
  return { newBalance: 999999, added: amount };
}

async function getModelConfig(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const sanitized = modelId.replace(/[^a-zA-Z0-9\-_.\/:]/g, '');
  if (sanitized !== modelId) return null;
  try {
    const model = await db.models.findById(sanitized);
    if (model) return model;
    // Fallback: try by name
    const all = await db.models.list();
    return all.find(m => m.name === sanitized && m.isEnabled) || null;
  } catch {
    return null;
  }
}

function extractTokenUsage(openRouterResponse) {
  const usage = openRouterResponse?.usage;
  if (usage) {
    return {
      inputTokens: Math.min(Math.floor(usage.prompt_tokens || 0), MAX_TOKENS_PER_REQUEST),
      outputTokens: Math.min(Math.floor(usage.completion_tokens || 0), MAX_TOKENS_PER_REQUEST),
      totalTokens: Math.min(Math.floor(usage.total_tokens || 0), MAX_TOKENS_PER_REQUEST * 2)
    };
  }
  return null;
}

module.exports = {
  estimateTokens, calculateCreditCost, getEstimatedToolCost,
  hasEnoughCredits, deductCredits, addCredits, getModelConfig,
  extractTokenUsage, MINIMUM_COST_FLOOR, MAX_TOKENS_PER_REQUEST
};

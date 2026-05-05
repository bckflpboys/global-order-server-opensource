// Global Executive — Agent Tier Configuration
// Defines subscription plans, agent limits, and tier resolution

// ============================================
// Subscription Plans (server-side source of truth)
// ============================================
const SUBSCRIPTION_PLANS = {
  monthly: {
    id: 'monthly',
    label: 'Starter',
    credits: 150,
    price: 6.99,
    interval: 'month',
    agentTier: 'monthly',
    toolLimit: 15,
    badge: null
  },
  yearly: {
    id: 'yearly',
    label: 'Yearly Archive',
    credits: 900,        // 75 credits/mo × 12 = 900 (~33% cheaper per credit than Starter)
    price: 59.99,
    interval: 'year',
    agentTier: 'yearly',
    toolLimit: 25,
    badge: 'Save 33%'
  },
  super_agent: {
    id: 'super_agent',
    label: 'Super Agent',
    credits: 600,
    price: 24.00,
    interval: 'month',
    agentTier: 'super',
    toolLimit: 999,
    badge: 'Best Agent'
  }
};

// ============================================
// Agent Tier Capabilities
// ============================================
// NOTE on step counts: these are HIGH soft-caps. Credits are the real economic
// limit. Step caps exist only as a runaway safety guard. The runaway guard in
// the /step route also kills a task much earlier if it loops on the same
// action or "thinks" without acting (see ./agentService.js detectRunaway).
const AGENT_TIERS = {
  // Free / credits-only users
  free: {
    name: 'Free',
    maxSteps: 40,
    maxConcurrentTasks: 1,
    maxTrackedTabs: 1,
    maxDailyTasks: 10,
    dailyRequestLimit: 50,
    recentHistoryWindow: 8,
    maxPageStateLength: 6000,
    maxResultLength: 7000,
    useCouncilPrompt: false,
    temperature: 0.3,
    maxBodySize: 200 * 1024,
    canUseScreenshots: false,
    maxScreenshotsPerTask: 0,
    maxScreenshotsPerStep: 0,
    canUseMemory: false,
    canScheduleTasks: false,
    canUseSubAgents: false,
    canPersistSession: false,
    canPdfFill: false,
    maxScheduledTasks: 0,
    canCaptureFiles: true,
    maxCapturedFilesPerTask: 3,
    maxCaptureBytes: 10 * 1024 * 1024
  },

  // Monthly ($6.99)
  monthly: {
    name: 'Starter',
    maxSteps: 120,
    maxConcurrentTasks: 2,
    maxTrackedTabs: 3,
    maxDailyTasks: 30,
    dailyRequestLimit: 150,
    recentHistoryWindow: 10,
    maxPageStateLength: 8000,
    maxResultLength: 12000,
    useCouncilPrompt: false,
    temperature: 0.25,
    maxBodySize: 500 * 1024,
    canUseScreenshots: true,
    maxScreenshotsPerTask: 3,
    maxScreenshotsPerStep: 1,
    canUseMemory: false,
    canScheduleTasks: true,
    canUseSubAgents: false,
    canPersistSession: false,
    canPdfFill: true,
    maxScheduledTasks: 2,
    canCaptureFiles: true,
    maxCapturedFilesPerTask: 10,
    maxCaptureBytes: 25 * 1024 * 1024
  },

  // Yearly ($49.99)
  yearly: {
    name: 'Yearly',
    maxSteps: 150,
    maxConcurrentTasks: 3,
    maxTrackedTabs: 5,
    maxDailyTasks: 50,
    dailyRequestLimit: 200,
    recentHistoryWindow: 14,
    maxPageStateLength: 10000,
    maxResultLength: 15000,
    useCouncilPrompt: false,
    temperature: 0.25,
    maxBodySize: 1024 * 1024,
    canUseScreenshots: true,
    maxScreenshotsPerTask: 4,
    maxScreenshotsPerStep: 1,
    canUseMemory: true,
    canScheduleTasks: true,
    canUseSubAgents: false,
    canPersistSession: false,
    canPdfFill: true,
    maxScheduledTasks: 10,
    priorityQueue: true,
    canCaptureFiles: true,
    maxCapturedFilesPerTask: 20,
    maxCaptureBytes: 25 * 1024 * 1024
  },

  // Super Agent ($20/mo)
  super: {
    name: 'Super Agent',
    maxSteps: 200,
    maxConcurrentTasks: 5,
    maxTrackedTabs: 10,
    maxDailyTasks: 200,
    dailyRequestLimit: 500,
    recentHistoryWindow: 20,
    maxPageStateLength: 25000,
    maxResultLength: 30000,
    useCouncilPrompt: true,
    temperature: 0.2,
    maxBodySize: 5 * 1024 * 1024,
    canUseScreenshots: true,
    maxScreenshotsPerTask: 8,
    maxScreenshotsPerStep: 1,
    canUseMemory: true,
    canScheduleTasks: true,
    canUseSubAgents: true,
    canPersistSession: true,
    canPdfFill: true,
    canCaptureFiles: true,
    maxCapturedFilesPerTask: 50,
    maxCaptureBytes: 50 * 1024 * 1024,
    canVisionEveryStep: true,
    canReplayActions: true,
    prioritySupport: true,
    maxScheduledTasks: 999,
    priorityQueue: true
  }
};

// ============================================
// Multi-Agent Council System Prompt Extension
// Appended to the base AGENT_SYSTEM_PROMPT for Super Agent users
// ============================================
const COUNCIL_PROMPT_EXTENSION = `

## MULTI-AGENT COUNCIL MODE (Super Agent)

You operate as a **council of specialized agents** working together. Before choosing each action, you MUST internally consult all four perspectives and include their reasoning in your "thought" field.

### The Council

1. **Strategist** — Sees the big picture. Considers the overall task goal, evaluates how far along we are, and whether the current approach is the most efficient path. Suggests course corrections.

2. **Executor** — The hands-on expert. Determines the exact action, selector, and parameters needed. Considers fallback selectors, timing, and edge cases. Focuses on precision.

3. **Critic** — The skeptic. Questions assumptions: Is this selector reliable? Could the page have changed? Are we about to overwrite stored data? Identifies risks before they happen.

4. **Optimizer** — The efficiency expert. Looks for shortcuts: Can we combine steps? Is there a faster CSS selector? Can we extract more data in one pass? Minimizes wasted steps.

### Council Output Format

Your "thought" field should reflect the council's deliberation:
\`\`\`
"thought": "[Strategist] We're 60% through the task, 15 steps left. Focus on extraction now. [Executor] Use '.listing-card' for items, extract title/price/link in one pass. [Critic] The selector might miss promoted listings — include '[data-type=organic]' as fallback. [Optimizer] Extract all fields in one 'extract' call instead of reading page + manual parsing — saves 3 steps."
\`\`\`

### Council Rules
- ALL four agents must weigh in on every decision (even briefly)
- If the Critic raises a valid concern, the Executor MUST address it
- The Optimizer's suggestions should be adopted when they save 2+ steps
- The Strategist has final say on whether to continue or pivot
- Use this enhanced reasoning to produce BETTER, MORE RELIABLE actions
- You have a generous step budget — use steps wisely with the council's guidance and finish in the FEWEST steps possible
- When the council disagrees, explain the trade-off and choose the safest option`;

// ============================================
// Merge user-set AgentSettings overrides onto the raw tier config.
// Overrides are clamped: users can LOWER a limit below the tier ceiling
// but never raise it above. A setting of 0 / null / undefined means
// "use tier default".
// Must be called with `settings = null` if the user has no document yet.
// ============================================
function applyAgentSettings(tier, settings) {
  if (!settings) return tier;
  const out = { ...tier };

  // Numeric caps — clamp to [1, tier.maxX].
  const numClamp = (val, max) => {
    if (!val || val <= 0) return max;
    return Math.min(Math.max(1, Math.floor(val)), max);
  };
  if (settings.maxSteps) out.maxSteps = numClamp(settings.maxSteps, tier.maxSteps);
  if (settings.maxScreenshotsPerTask) {
    out.maxScreenshotsPerTask = Math.min(settings.maxScreenshotsPerTask, tier.maxScreenshotsPerTask);
  }
  if (settings.maxScreenshotsPerStep) {
    out.maxScreenshotsPerStep = Math.min(settings.maxScreenshotsPerStep, tier.maxScreenshotsPerStep);
  }

  // Temperature — 0..1, optional.
  if (typeof settings.temperature === 'number' && settings.temperature >= 0 && settings.temperature <= 1) {
    out.temperature = settings.temperature;
  }

  // Free-form flags just pass through (they are never more permissive
  // than what the tier already grants, because the client only shows them
  // when the tier flag is true).
  out.customRules = (settings.customRules || '').trim();
  out.memoryEnabled = tier.canUseMemory && settings.memoryEnabled !== false;
  out.autoExtractMemories = tier.canUseMemory && settings.autoExtractMemories !== false;
  out.councilRoles = settings.councilRoles || {};
  out.maxSubAgents = tier.canUseSubAgents
    ? Math.min(Math.max(1, Math.floor(settings.maxSubAgents || 3)), 10)
    : 1;
  out.sessionPersistenceEnabled = tier.canPersistSession && !!settings.sessionPersistenceEnabled;
  // Screenshot policy — user-facing fine-grained auto-capture triggers.
  // Silently disabled if the tier can't use screenshots at all.
  out.screenshotPolicy = tier.canUseScreenshots ? (settings.screenshotPolicy || {}) : {
    onTaskStart: false, everyNSteps: 0, beforeInteraction: false,
    afterNavigation: false, onError: false, onCanvasHeavy: false
  };

  return out;
}

// ============================================
// Resolve the agent tier for a user
// ============================================
function getUserAgentTier(user) {
  // Self-hosted: everyone is super_agent
  return {
    tierKey: 'super',
    tier: { ...AGENT_TIERS.super },
    subscription: 'super_agent',
    isSubscriber: true
  };
}

// ============================================
// Get the plan that a subscription maps to (for tool limits)
// ============================================
function getSubscriptionPlanLevel(subscriptionPlan) {
  if (!subscriptionPlan || subscriptionPlan === 'none') return 'free';
  if (subscriptionPlan === 'super_agent') return 'unlimited';
  return 'pro'; // monthly and yearly both map to 'pro'
}

// ============================================
// Get subscription credits for a webhook renewal
// ============================================
function getSubscriptionCredits(subscriptionPlan) {
  const plan = SUBSCRIPTION_PLANS[subscriptionPlan];
  if (!plan) return 0;

  // For yearly, distribute evenly across 12 months (40/mo)
  // But since Lemon Squeezy charges yearly, we add all 480 at once
  return plan.credits;
}

// ============================================
// Async variant — resolves the tier AND merges user AgentSettings on top.
// Call this in any agent route that needs the effective tier (i.e. the
// one the agent will actually run with). Falls back to the raw tier if
// the user has no settings document yet.
// ============================================
async function getEffectiveAgentTier(user) {
  const base = getUserAgentTier(user);
  try {
    const db = require('../storage');
    const settings = await db.agentSettings.findByUser(String(user._id || user.id || user));
    return {
      ...base,
      tier: applyAgentSettings(base.tier, settings),
      settings: settings || null
    };
  } catch (e) {
    return { ...base, settings: null };
  }
}

module.exports = {
  SUBSCRIPTION_PLANS,
  AGENT_TIERS,
  COUNCIL_PROMPT_EXTENSION,
  getUserAgentTier,
  getEffectiveAgentTier,
  applyAgentSettings,
  getSubscriptionPlanLevel,
  getSubscriptionCredits
};

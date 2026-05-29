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
    canPersistSession: true,
    maxSessionMessages: 3,
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
    canPersistSession: true,
    maxSessionMessages: 10,
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
    canPersistSession: true,
    maxSessionMessages: 10,
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
    maxSessionMessages: 0,
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
// Multi-Agent Council — Default Member Roster
// ============================================
const DEFAULT_COUNCIL_MEMBERS = [
  {
    id: 'strategist',
    name: 'Strategist',
    description: 'Sees the big picture. Considers the overall task goal, evaluates how far along we are, and whether the current approach is the most efficient path. Suggests course corrections.',
    model: '',
    enabled: true,
    isBuiltIn: true
  },
  {
    id: 'executor',
    name: 'Executor',
    description: 'The hands-on expert. Determines the exact action, selector, and parameters needed. Considers fallback selectors, timing, and edge cases. Focuses on precision.',
    model: '',
    enabled: true,
    isBuiltIn: true
  },
  {
    id: 'critic',
    name: 'Critic',
    description: 'The skeptic. Questions assumptions: Is this selector reliable? Could the page have changed? Are we about to overwrite stored data? Identifies risks before they happen.',
    model: '',
    enabled: true,
    isBuiltIn: true
  },
  {
    id: 'optimizer',
    name: 'Optimizer',
    description: 'The efficiency expert. Looks for shortcuts: Can we combine steps? Is there a faster CSS selector? Can we extract more data in one pass? Minimizes wasted steps.',
    model: '',
    enabled: true,
    isBuiltIn: true
  }
];

// ============================================
// Resolve effective council member roster.
// Source-of-truth precedence:
//   1. settings.councilMembers (new-style array, if non-empty)
//   2. Built-in defaults, with per-role model overlaid from the legacy
//      settings.councilRoles map (for users who haven't yet re-saved
//      through the redesigned Setup card).
//   3. Defaults only.
// ============================================
function resolveCouncilMembers(settings) {
  if (settings && Array.isArray(settings.councilMembers) && settings.councilMembers.length > 0) {
    return settings.councilMembers.map(m => ({
      id: String(m.id || ''),
      name: String(m.name || '').trim(),
      description: String(m.description || '').trim(),
      model: String(m.model || '').trim(),
      enabled: m.enabled !== false,
      isBuiltIn: !!m.isBuiltIn
    })).filter(m => m.id && m.name);
  }
  const legacyRoles = (settings && settings.councilRoles) || {};
  return DEFAULT_COUNCIL_MEMBERS.map(d => ({
    ...d,
    model: typeof legacyRoles[d.id] === 'string' ? legacyRoles[d.id] : ''
  }));
}

// ============================================
// Build the dynamic Multi-Agent Council prompt extension.
// Renders the system-prompt block from the user's ENABLED members. If no
// members are enabled, returns an empty string (caller should also skip
// appending entirely when the master `councilEnabled` flag is false).
// ============================================
function buildCouncilPromptExtension(members) {
  const list = (Array.isArray(members) ? members : DEFAULT_COUNCIL_MEMBERS)
    .filter(m => m && m.enabled !== false && m.name && m.description);
  if (list.length === 0) return '';

  const numbered = list
    .map((m, i) => `${i + 1}. **${m.name}** — ${m.description}`)
    .join('\n\n');

  const exampleNames = list.slice(0, 4).map(m => `[${m.name}]`).join(' … ');
  const everyAgentRule = list.length === 1
    ? `- The single active member must weigh in on every decision`
    : `- ALL ${list.length} agents must weigh in on every decision (even briefly)`;

  return `

## MULTI-AGENT COUNCIL MODE (Super Agent)

You operate as a **council of specialized agents** working together. Before choosing each action, you MUST internally consult every active perspective and include their reasoning in your "thought" field.

### The Council

${numbered}

### Council Output Format

Your "thought" field should reflect the council's deliberation, tagging each member's contribution like:
\`\`\`
"thought": "${exampleNames} <each member's brief take on the next action>"
\`\`\`

### Council Rules
${everyAgentRule}
- If a member named "Critic" raises a valid concern, the member named "Executor" MUST address it
- Suggestions from a member named "Optimizer" should be adopted when they save 2+ steps
- A member named "Strategist" has final say on whether to continue or pivot
- Use this enhanced reasoning to produce BETTER, MORE RELIABLE actions
- You have a generous step budget — use steps wisely with the council's guidance and finish in the FEWEST steps possible
- When the council disagrees, explain the trade-off and choose the safest option`;
}

// Back-compat export — the static rendering of the default 4-member
// roster. Some older consumers (or tests) may still import this constant.
const COUNCIL_PROMPT_EXTENSION = buildCouncilPromptExtension(DEFAULT_COUNCIL_MEMBERS);

// ============================================
// Merge user-set AgentSettings overrides onto the raw tier config.
// Overrides are clamped: users can LOWER a limit below the tier ceiling
// but never raise it above. A setting of 0 / null / undefined means
// "use tier default".
// Must be called with `settings = null` if the user has no document yet.
// ============================================
function applyAgentSettings(tier, settings) {
  if (!settings) {
    // User has no AgentSettings doc yet — fall back to model defaults so
    // the behaviour matches what the storage would have produced on insert.
    return {
      ...tier,
      sessionPersistenceEnabled: !!tier.canPersistSession,
      councilEnabled: true,
      councilMembers: resolveCouncilMembers(null)
    };
  }
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
  // Master council switch — defaulted to true so existing users keep the
  // current behaviour. agentService.js gates COUNCIL_PROMPT_EXTENSION
  // injection on `useCouncilPrompt && councilEnabled`.
  out.councilEnabled = settings.councilEnabled !== false;
  // Resolved member roster (built-ins seeded with legacy model overlay
  // when the user hasn't yet saved through the new card).
  out.councilMembers = resolveCouncilMembers(settings);
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
  // Since self-hosted has no payment processing, we just return plan credits
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
  DEFAULT_COUNCIL_MEMBERS,
  buildCouncilPromptExtension,
  resolveCouncilMembers,
  getUserAgentTier,
  getEffectiveAgentTier,
  applyAgentSettings,
  getSubscriptionPlanLevel,
  getSubscriptionCredits
};

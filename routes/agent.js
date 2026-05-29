// Agent Routes — Self-hosted version
// No security middleware, no rate limits, no credit deduction.
// All users = super_agent tier. Uses storage abstraction.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getEffectiveAgentTier } = require('../services/agentTiers');
const db = require('../storage');

// Optional services — graceful degradation
let agentService, memoryService, domainRuleService, notificationService;
let obsService, pdfService, webSearchService, taskLock;
try { agentService = require('../services/agentService'); } catch {}
try { memoryService = require('../services/memoryService'); } catch {}
try { domainRuleService = require('../services/domainRuleService'); } catch {}
try { notificationService = require('../services/notificationService'); } catch {}
try { obsService = require('../services/obsService'); } catch {}
try { pdfService = require('../services/pdfService'); } catch {}
try { webSearchService = require('../services/webSearchService'); } catch {}
try { taskLock = require('../services/taskLock'); } catch {}

const router = express.Router();

const VALID_MODES = ['copilot', 'autopilot', 'subagents'];
const MAX_USER_REPLY_LENGTH = 5000;

function parseUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return { browser: '', os: '' };
  let browser = '';
  const edge = ua.match(/Edg\/(\d[\d.]*)/);
  const chrome = ua.match(/Chrome\/(\d[\d.]*)/);
  const firefox = ua.match(/Firefox\/(\d[\d.]*)/);
  if (edge) browser = `Edge ${edge[1]}`;
  else if (chrome) browser = `Chrome ${chrome[1]}`;
  else if (firefox) browser = `Firefox ${firefox[1]}`;
  let os = '';
  if (/Windows NT 10/i.test(ua)) os = 'Windows 10/11';
  else if (/Mac OS X/i.test(ua)) os = 'macOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return { browser, os };
}

async function buildEnvironmentContext(userId, reqBody, task) {
  const env = { nowISO: new Date().toISOString(), userAway: false };
  const ua = reqBody?.userAgent || '';
  if (ua) { const p = parseUserAgent(ua); env.browser = p.browser; env.os = p.os; }
  if (reqBody?.locale) env.locale = String(reqBody.locale).slice(0, 20);
  if (reqBody?.timezone) env.timezone = String(reqBody.timezone).slice(0, 60);
  if (reqBody?.viewport?.width > 0) env.viewport = { width: Math.min(10000, Math.round(reqBody.viewport.width)), height: Math.min(10000, Math.round(reqBody.viewport.height)) };
  try {
    const integ = await db.integrations.findByUser(userId);
    const tg = !!(integ?.telegram?.enabled && integ?.telegram?.botToken && integ?.telegram?.chatId);
    const wa = !!(integ?.whatsapp?.enabled && integ?.whatsapp?.verified);
    env.integrations = { telegram: tg, whatsapp: wa, notificationChannel: integ?.preferences?.notifyChannel || (tg ? 'telegram' : wa ? 'whatsapp' : 'none') };
  } catch { env.integrations = { telegram: false, whatsapp: false, notificationChannel: 'none' }; }
  return env;
}

async function buildAgentPromptContext(userId, url, tier) {
  const ctx = { memoryBlock: '', memoryIds: [], domainRulesBlock: '', availableTools: [] };
  try {
    if (memoryService?.loadMemoriesForAgent) {
      const mems = await memoryService.loadMemoriesForAgent(userId, url);
      ctx.memoryIds = mems.ids || [];
      ctx.memoryBlock = memoryService.renderMemoriesForPrompt(mems.memories || []);
    }
  } catch {}
  try {
    if (domainRuleService?.loadRulesForHostname && domainRuleService?.renderRulesForPrompt) {
      const hostname = domainRuleService.hostnameOf(url);
      const rules = await domainRuleService.loadRulesForHostname(userId, hostname);
      ctx.domainRulesBlock = domainRuleService.renderRulesForPrompt(rules);
    }
  } catch {}
  try {
    const tools = await db.tools.findByUser(userId);
    ctx.availableTools = (tools || []).filter(t => t.status === 'active').map(t => ({ id: t._id, name: t.name, description: t.description, targetSites: t.targetSites }));
  } catch {}
  return ctx;
}

async function resolveTaskSource(userId, prompt, bodySource) {
  if (bodySource === 'telegram' || bodySource === 'whatsapp') return bodySource;
  try {
    const integ = await db.integrations.findByUser(userId);
    const last = integ?.lastInboxConsumed;
    if (!last?.source || !last.prompt || !last.at) return 'web';
    if (Date.now() - new Date(last.at).getTime() > 5 * 60 * 1000) return 'web';
    if (last.prompt.trim() !== String(prompt || '').trim()) return 'web';
    const matched = last.source;
    await db.integrations.update(integ._id, { lastInboxConsumed: { source: '', prompt: '', at: null } });
    return matched;
  } catch { return 'web'; }
}

async function pickAgentModel(modelId) {
  if (modelId) { const m = await db.models.findById(modelId); if (m?.isAgentModel) return m; }
  const def = await db.models.findDefault();
  return def;
}

function serializeGoalLedger(task) { return task.goalLedger || { goals: [], milestones: [] }; }

async function notifyForTask(task, msg) {
  try {
    if (!notificationService?.notify) return;
    await notificationService.notify(task.userId, msg, { forceChannel: task.source === 'telegram' ? 'telegram' : task.source === 'whatsapp' ? 'whatsapp' : undefined });
  } catch {}
}

function truncateResult(r) { if (typeof r === 'string') return r.slice(0, 50000); try { return JSON.parse(JSON.stringify(r)).slice(0, 50000); } catch { return String(r).slice(0, 50000); } }

// ============================================
// POST /api/agent/plan — Plan a new agent task
// ============================================
router.post('/plan', requireAuth, async (req, res) => {
  try {
    const { prompt, tabUrl, tabTitle, allTabs, mode: bodyMode, modelId, source: bodySource } = req.body;
    const userId = String(req.userId);
    const mode = VALID_MODES.includes(bodyMode) ? bodyMode : 'copilot';
    const { tier } = await getEffectiveAgentTier(req.user);

    const modelConfig = await pickAgentModel(modelId);
    if (!modelConfig) return res.status(503).json({ error: 'No agent-capable AI models available' });

    const plannerCtx = await buildAgentPromptContext(userId, tabUrl || '', tier);
    if (!agentService?.planTask) return res.status(503).json({ error: 'Agent service not available' });

    const planResult = await agentService.planTask(prompt, {
      model: modelConfig.openRouterId, modelConfig, tierConfig: tier, activeTabUrl: tabUrl || '',
      activeTabTitle: tabTitle || '', allTabs: allTabs || [], memoryBlock: plannerCtx.memoryBlock
    });
    if (memoryService?.markMemoriesUsed) memoryService.markMemoriesUsed(plannerCtx.memoryIds);

    const taskSource = await resolveTaskSource(userId, prompt.trim(), bodySource);
    const title = prompt.length > 60 ? prompt.substring(0, 57) + '...' : prompt;
    const hasInputs = planResult.requiredInputs.length > 0;
    const task = await db.agentTasks.create({
      userId, title, originalPrompt: prompt, mode, status: hasInputs ? 'briefing' : 'pending',
      plan: planResult.plan, taskType: planResult.taskType || 'action',
      requiredInputs: planResult.requiredInputs, permissionsRequested: planResult.permissionsRequested,
      modelUsed: modelConfig.name, source: taskSource,
      trackedTabs: [{ tabIndex: 0, url: tabUrl || '', title: tabTitle || '', openedByAgent: false, status: 'active' }],
      activeTabIndex: 0, totalCreditsUsed: 0
    });

    res.json({
      taskId: task._id.toString(), status: task.status, mode,
      plan: planResult.plan, taskType: planResult.taskType || 'action',
      requiredInputs: planResult.requiredInputs, permissionsRequested: planResult.permissionsRequested,
      tier: { name: tier.name, maxSteps: tier.maxSteps, maxTabs: tier.maxTrackedTabs },
      usage: { creditsUsed: 0, creditsRemaining: 999999, model: modelConfig.name }
    });
  } catch (err) {
    console.error('[Agent Plan Error]', err.message);
    res.status(500).json({ error: 'Failed to generate plan.' });
  }
});

// ============================================
// POST /api/agent/brief — Submit briefing, start run
// ============================================
router.post('/brief', requireAuth, async (req, res) => {
  try {
    const { taskId, briefing, permissions, modelId } = req.body;
    const userId = String(req.userId);
    const task = await db.agentTasks.findById(taskId);
    if (!task || String(task.userId) !== userId) return res.status(404).json({ error: 'Task not found' });
    if (!['briefing', 'planning'].includes(task.status)) return res.status(400).json({ error: `Task is ${task.status}` });

    if (briefing && typeof briefing === 'object') task.briefing = { ...task.briefing, ...briefing };
    if (permissions && typeof permissions === 'object') task.permissions = { ...(task.permissions || {}), ...permissions };

    const modelConfig = await pickAgentModel(modelId);
    if (!modelConfig) return res.status(503).json({ error: 'No agent-capable AI models available' });
    const { tier } = await getEffectiveAgentTier(req.user);

    if (!agentService?.planNextAction) return res.status(503).json({ error: 'Agent service not available' });
    const promptCtx = await buildAgentPromptContext(userId, '', tier);
    const envCtx = await buildEnvironmentContext(userId, req.body, task);
    const result = await agentService.planNextAction(task, null, {
      model: modelConfig.openRouterId, modelConfig, tierConfig: tier, sessionId: `ge-task-${task._id}`,
      environment: envCtx, memoryBlock: promptCtx.memoryBlock, availableTools: promptCtx.availableTools
    });
    if (memoryService?.markMemoriesUsed) memoryService.markMemoriesUsed(promptCtx.memoryIds);

    const firstAction = result.action || { action: 'think', params: {}, thought: 'Starting task' };
    task.status = 'running';
    task.currentStepNumber = 1;
    task.steps = task.steps || [];
    task.steps.push({ stepNumber: 1, thought: firstAction.thought, action: firstAction.action, params: firstAction.params, expectation: firstAction.expectation, status: 'pending', creditsUsed: 0, model: modelConfig.name });
    await db.agentTasks.update(task._id, task);

    res.json({
      taskId: task._id.toString(), status: 'running', stepNumber: 1,
      action: firstAction, goalLedger: serializeGoalLedger(task),
      tier: { name: tier.name, maxSteps: tier.maxSteps, maxTabs: tier.maxTrackedTabs },
      usage: { creditsUsed: 0, creditsRemaining: 999999, model: modelConfig.name, totalTaskCredits: task.totalCreditsUsed }
    });
  } catch (err) {
    console.error('[Agent Brief Error]', err.message);
    res.status(500).json({ error: 'Failed to start agent task.' });
  }
});

// ============================================
// POST /api/agent/start — Legacy direct start
// ============================================
router.post('/start', requireAuth, async (req, res) => {
  try {
    const { prompt, tabUrl, tabTitle, allTabs, mode: bodyMode, modelId, source: bodySource } = req.body;
    const userId = String(req.userId);
    const mode = VALID_MODES.includes(bodyMode) ? bodyMode : 'copilot';
    const { tier } = await getEffectiveAgentTier(req.user);

    const modelConfig = await pickAgentModel(modelId);
    if (!modelConfig) return res.status(503).json({ error: 'No agent-capable AI models available' });

    const title = prompt.length > 60 ? prompt.substring(0, 57) + '...' : prompt;
    const taskSource = await resolveTaskSource(userId, prompt.trim(), bodySource);
    const task = await db.agentTasks.create({
      userId, title, originalPrompt: prompt, mode, status: 'running',
      modelUsed: modelConfig.name, source: taskSource,
      trackedTabs: [{ tabIndex: 0, url: tabUrl || '', title: tabTitle || '', openedByAgent: false, status: 'active' }],
      activeTabIndex: 0, steps: [], totalCreditsUsed: 0
    });

    if (!agentService?.planNextAction) return res.status(503).json({ error: 'Agent service not available' });
    const envCtx = await buildEnvironmentContext(userId, req.body, task);
    const promptCtx = await buildAgentPromptContext(userId, tabUrl || '', tier);
    const result = await agentService.planNextAction(task, { url: tabUrl || '', title: tabTitle || '', visibleText: '' }, {
      model: modelConfig.openRouterId, modelConfig, tierConfig: tier, sessionId: `ge-task-${task._id}`,
      environment: envCtx, memoryBlock: promptCtx.memoryBlock, availableTools: promptCtx.availableTools, allTabs: allTabs || []
    });
    if (memoryService?.markMemoriesUsed) memoryService.markMemoriesUsed(promptCtx.memoryIds);

    const action = result.action || { action: 'think', params: {}, thought: 'Starting' };
    task.currentStepNumber = 1;
    task.steps.push({ stepNumber: 1, thought: action.thought, action: action.action, params: action.params, expectation: action.expectation, status: 'pending', creditsUsed: 0, model: modelConfig.name });
    await db.agentTasks.update(task._id, task);

    res.json({
      taskId: task._id.toString(), status: 'running', stepNumber: 1,
      action, tier: { name: tier.name, maxSteps: tier.maxSteps, maxTabs: tier.maxTrackedTabs },
      usage: { creditsUsed: 0, creditsRemaining: 999999, model: modelConfig.name, totalTaskCredits: 0 }
    });
  } catch (err) {
    console.error('[Agent Start Error]', err.message);
    res.status(500).json({ error: 'Failed to start agent task.' });
  }
});

// ============================================
// POST /api/agent/step — Send action result, get next action
// ============================================
router.post('/step', requireAuth, async (req, res) => {
  try {
    const { taskId, stepNumber, pageState, modelId } = req.body;
    let { result, error } = req.body;
    const userId = String(req.userId);
    const { tier } = await getEffectiveAgentTier(req.user);

    const task = await db.agentTasks.findById(taskId);
    if (!task || String(task.userId) !== userId) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'running') return res.status(400).json({ error: `Task is ${task.status}` });

    // Step limit check (generous for self-hosted)
    if (task.currentStepNumber >= tier.maxSteps) {
      task.status = 'completed';
      task.summary = 'Task reached maximum step limit';
      await db.agentTasks.update(task._id, task);
      return res.json({ taskId: task._id.toString(), status: 'completed', summary: task.summary, done: true });
    }

    const modelConfig = await pickAgentModel(modelId);
    if (!modelConfig) return res.status(503).json({ error: 'No AI models available' });

    // Update previous step
    const lastStep = (task.steps || [])[task.steps.length - 1];
    if (lastStep && lastStep.stepNumber === stepNumber) {
      lastStep.result = result ? truncateResult(result) : null;
      lastStep.error = error || '';
      lastStep.status = 'completed';
    }

    // Handle 'done' action
    if (lastStep?.action === 'done') {
      task.status = 'completed';
      task.summary = lastStep.params?.summary || 'Task completed';
      await db.agentTasks.update(task._id, task);
      notifyForTask(task, `✅ Task complete: ${task.title}\n\n${task.summary}`);
      return res.json({ taskId: task._id.toString(), status: 'completed', summary: task.summary, done: true });
    }

    // Plan next action
    if (!agentService?.planNextAction) return res.status(503).json({ error: 'Agent service not available' });
    const stepUrl = pageState?.url || (task.trackedTabs?.[task.activeTabIndex || 0]?.url) || '';
    const promptCtx = await buildAgentPromptContext(userId, stepUrl, tier);
    const envCtx = await buildEnvironmentContext(userId, req.body, task);
    const aiResult = await agentService.planNextAction(task, pageState || {}, {
      model: modelConfig.openRouterId, modelConfig, tierConfig: tier, sessionId: `ge-task-${task._id}`,
      environment: envCtx, memoryBlock: promptCtx.memoryBlock, domainRulesBlock: promptCtx.domainRulesBlock,
      availableTools: promptCtx.availableTools
    });
    if (memoryService?.markMemoriesUsed) memoryService.markMemoriesUsed(promptCtx.memoryIds);

    const newAction = aiResult.action || { action: 'think', params: {}, thought: 'Continuing' };
    const newStepNumber = task.currentStepNumber + 1;
    task.currentStepNumber = newStepNumber;
    task.steps.push({
      stepNumber: newStepNumber, thought: newAction.thought, action: newAction.action,
      params: newAction.params, expectation: newAction.expectation, status: 'pending',
      creditsUsed: 0, model: modelConfig.name
    });

    const isDone = newAction.action === 'done';
    const isAskUser = newAction.action === 'askUser';

    if (isDone) {
      task.status = 'completed';
      task.summary = newAction.params?.summary || 'Task completed';
      notifyForTask(task, `✅ Task complete: ${task.title}\n\n${task.summary}`);
    }

    if (isAskUser && task.mode === 'autopilot') {
      task.status = 'failed';
      task.summary = `Auto-pilot needed user input: "${newAction.params?.question || ''}"`;
      notifyForTask(task, `❌ Task failed: ${task.title}\n\n${task.summary}`);
    }

    await db.agentTasks.update(task._id, task);

    res.json({
      taskId: task._id.toString(), status: task.status, stepNumber: newStepNumber,
      action: newAction, done: isDone, isAskUser,
      goalLedger: serializeGoalLedger(task),
      tier: { name: tier.name, maxSteps: tier.maxSteps, maxTabs: tier.maxTrackedTabs },
      usage: { creditsUsed: 0, creditsRemaining: 999999, model: modelConfig.name, totalTaskCredits: task.totalCreditsUsed || 0 }
    });
  } catch (err) {
    console.error('[Agent Step Error]', err.message);
    res.status(500).json({ error: 'Step processing failed: ' + (err.message || 'unknown') });
  }
});

// ============================================
// POST /api/agent/answer — Reply to askUser
// ============================================
router.post('/answer', requireAuth, async (req, res) => {
  try {
    const { taskId, reply } = req.body;
    const userId = String(req.userId);
    if (typeof reply !== 'string' || reply.length > MAX_USER_REPLY_LENGTH) return res.status(400).json({ error: 'Invalid reply' });

    const task = await db.agentTasks.findById(taskId);
    if (!task || String(task.userId) !== userId) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'awaiting_user') return res.status(400).json({ error: `Task is ${task.status}` });

    task.pendingQuestion = { kind: null, text: '', choices: [], pendingAction: null, askedAtStep: 0 };
    task.status = 'running';
    await db.agentTasks.update(task._id, task);
    res.json({ taskId: task._id.toString(), status: 'running', message: 'Reply accepted' });
  } catch (err) {
    console.error('[Agent Answer Error]', err.message);
    res.status(500).json({ error: 'Failed to process reply.' });
  }
});

// ============================================
// POST /api/agent/stop — Stop a running task
// ============================================
router.post('/stop', requireAuth, async (req, res) => {
  try {
    const { taskId } = req.body;
    const task = await db.agentTasks.findById(taskId);
    if (!task || String(task.userId) !== String(req.userId)) return res.status(404).json({ error: 'Task not found' });
    if (['completed', 'failed', 'cancelled'].includes(task.status)) return res.json({ taskId: task._id.toString(), status: task.status, message: 'Task already ended' });
    task.status = 'cancelled';
    task.summary = 'Task cancelled by user';
    await db.agentTasks.update(task._id, task);
    res.json({ taskId: task._id.toString(), status: 'cancelled', stepsCompleted: task.currentStepNumber, totalCreditsUsed: task.totalCreditsUsed, storedData: task.storedData });
  } catch (err) {
    console.error('[Agent Stop Error]', err.message);
    res.status(500).json({ error: 'Failed to stop task' });
  }
});

// ============================================
// GET /api/agent/tasks — List user's agent tasks
// ============================================
router.get('/tasks', requireAuth, async (req, res) => {
  try {
    const tasks = await db.agentTasks.findByUser(String(req.userId));
    res.json({ tasks: (tasks || []).slice(0, 50).map(t => ({
      id: t._id.toString(), title: t.title, status: t.status,
      steps: t.currentStepNumber, creditsUsed: t.totalCreditsUsed,
      model: t.modelUsed, summary: t.summary, createdAt: t.createdAt, updatedAt: t.updatedAt
    }))});
  } catch (err) {
    console.error('[Agent Tasks Error]', err.message);
    res.status(500).json({ error: 'Failed to load tasks' });
  }
});

// ============================================
// GET /api/agent/tasks/:id — Get task details
// ============================================
router.get('/tasks/:id', requireAuth, async (req, res) => {
  try {
    const task = await db.agentTasks.findById(req.params.id);
    if (!task || String(task.userId) !== String(req.userId)) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: {
      id: task._id.toString(), title: task.title, originalPrompt: task.originalPrompt,
      status: task.status, mode: task.mode, steps: task.steps, currentStepNumber: task.currentStepNumber,
      trackedTabs: task.trackedTabs, activeTabIndex: task.activeTabIndex, summary: task.summary,
      totalCreditsUsed: task.totalCreditsUsed, modelUsed: task.modelUsed, storedData: task.storedData,
      permissions: task.permissions, briefing: task.briefing, createdAt: task.createdAt, updatedAt: task.updatedAt
    }});
  } catch (err) {
    console.error('[Agent Task Detail Error]', err.message);
    res.status(500).json({ error: 'Failed to load task details' });
  }
});

// ============================================
// GET /api/agent/pending-chat-reply
// ============================================
router.get('/pending-chat-reply', requireAuth, async (req, res) => {
  try {
    const tasks = await db.agentTasks.findByUser(String(req.userId));
    const awaiting = (tasks || []).filter(t => t.status === 'awaiting_user');
    for (const task of awaiting) {
      const tg = task.pendingQuestion?.lastTelegramReply;
      const wa = task.pendingQuestion?.lastWhatsAppReply;
      const reply = tg || wa;
      if (reply) {
        const source = tg ? 'telegram' : 'whatsapp';
        task.pendingQuestion.lastTelegramReply = '';
        task.pendingQuestion.lastWhatsAppReply = '';
        await db.agentTasks.update(task._id, task);
        return res.json({ taskId: task._id.toString(), reply, source });
      }
    }
    return res.status(204).end();
  } catch (err) {
    console.error('[Pending Chat Reply Error]', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================
// GET /api/agent/pending-reply/:taskId
// ============================================
router.get('/pending-reply/:taskId', requireAuth, async (req, res) => {
  try {
    const task = await db.agentTasks.findById(req.params.taskId);
    if (!task || String(task.userId) !== String(req.userId)) return res.status(404).json({ error: 'Task not found' });
    const reply = task.pendingQuestion?.lastTelegramReply || task.pendingQuestion?.lastWhatsAppReply || '';
    if (reply) {
      task.pendingQuestion.lastTelegramReply = '';
      task.pendingQuestion.lastWhatsAppReply = '';
      await db.agentTasks.update(task._id, task);
    }
    res.json({ reply, source: task.pendingQuestion?.lastTelegramReply ? 'telegram' : 'whatsapp' });
  } catch (err) {
    console.error('[Pending Reply Error]', err.message);
    res.status(500).json({ error: 'Failed' });
  }
});

// ============================================
// POST /api/agent/resume/:id — Resume a finished task
// ============================================
router.post('/resume/:id', requireAuth, async (req, res) => {
  try {
    const prior = await db.agentTasks.findById(req.params.id);
    if (!prior || String(prior.userId) !== String(req.userId)) return res.status(404).json({ error: 'Task not found' });
    if (!['completed', 'failed', 'cancelled'].includes(prior.status)) return res.status(400).json({ error: 'Only finished tasks can be resumed.' });

    const newPrompt = req.body?.prompt || `Continue from previous task. Goal: "${prior.originalPrompt}". Summary: ${prior.summary || '(none)'}.`;
    const fresh = await db.agentTasks.create({
      userId: String(req.userId), title: ('Resume: ' + (prior.title || 'previous task')).slice(0, 120),
      originalPrompt: newPrompt.slice(0, 5000), mode: prior.mode === 'subagents' ? 'autopilot' : prior.mode,
      briefing: prior.briefing || {}, permissions: prior.permissions || {}, source: prior.source || 'web',
      status: 'pending', storedData: prior.storedData || {}, resumedFromId: prior._id
    });
    res.json({ taskId: fresh._id.toString(), status: 'pending', message: 'Task resumed' });
  } catch (err) {
    console.error('[Agent Resume Error]', err.message);
    res.status(500).json({ error: 'Failed to resume task.' });
  }
});

// ============================================
// POST /api/agent/screenshot — Upload screenshot
// ============================================
router.post('/screenshot', requireAuth, async (req, res) => {
  try {
    const { taskId, imageBase64, stepNumber } = req.body;
    const userId = String(req.userId);
    const task = await db.agentTasks.findById(taskId);
    if (!task || String(task.userId) !== userId) return res.status(404).json({ error: 'Task not found' });

    if (!obsService?.isConfigured || !obsService.isConfigured()) {
      return res.status(503).json({ error: 'Screenshot storage not configured. Set OBS credentials in .env' });
    }

    const buf = Buffer.from(imageBase64, 'base64');
    const uploaded = await obsService.putObject(`screenshots/${task._id}/${stepNumber || Date.now()}.png`, buf, 'image/png');
    task.screenshotsUsed = { count: (task.screenshotsUsed?.count || 0) + 1, lastSignedUrl: uploaded.signedUrl, lastCapturedAt: new Date(), lastExpiresAt: uploaded.expiresAt };
    await db.agentTasks.update(task._id, task);
    res.json({ success: true, signedUrl: uploaded.signedUrl, expiresAt: uploaded.expiresAt });
  } catch (err) {
    console.error('[Agent Screenshot Error]', err.message);
    res.status(500).json({ error: 'Failed to store screenshot.' });
  }
});

// ============================================
// POST /api/agent/capture-file — Capture a file
// ============================================
router.post('/capture-file', requireAuth, async (req, res) => {
  try {
    const { taskId, filename, mime, dataBase64, sourceUrl, stepNumber } = req.body;
    const userId = String(req.userId);
    const task = await db.agentTasks.findById(taskId);
    if (!task || String(task.userId) !== userId) return res.status(404).json({ error: 'Task not found' });

    if (!obsService?.isConfigured || !obsService.isConfigured()) {
      return res.status(503).json({ error: 'File storage not configured.' });
    }

    const buf = Buffer.from(dataBase64, 'base64');
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const objectKey = `captures/${task._id}/${id}/${filename}`;
    const uploaded = await obsService.putObject(objectKey, buf, mime);
    task.capturedFiles = task.capturedFiles || [];
    task.capturedFiles.push({ id, filename, objectKey, mime, size: buf.length, sourceUrl, capturedAt: new Date(), capturedAtStep: stepNumber });
    await db.agentTasks.update(task._id, task);
    res.json({ success: true, fileId: id, signedUrl: uploaded.signedUrl, expiresAt: uploaded.expiresAt });
  } catch (err) {
    console.error('[Agent CaptureFile Error]', err.message);
    res.status(500).json({ error: 'Failed to store captured file.' });
  }
});

module.exports = router;

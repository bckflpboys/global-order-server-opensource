// Agent Settings, Memory, Domain Rules, Scheduled Tasks — Self-hosted version
// All users get super_agent tier (no feature gating). Uses storage abstraction.
// No security middleware, no rate limits.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();
router.use(requireAuth);

// Super agent tier ceilings — self-hosted users get everything
const SUPER_AGENT_CEILINGS = {
  maxSteps: 500,
  maxScreenshotsPerTask: 10,
  maxScreenshotsPerStep: 3,
  canUseScreenshots: true,
  canUseMemory: true,
  canUseSubAgents: true,
  canPersistSession: true,
  canScheduleTasks: true,
  maxScheduledTasks: 50,
  useCouncilPrompt: true
};

const HOST_RE = /^(\*|[a-z0-9.-]{1,253})$/i;

// ============================================================
// AGENT SETTINGS
// ============================================================

router.get('/agent-settings', async (req, res) => {
  try {
    const settings = await db.agentSettings.findByUser(String(req.userId));
    res.json({
      settings: settings || null,
      tierKey: 'super_agent',
      ceilings: SUPER_AGENT_CEILINGS
    });
  } catch (e) {
    console.error('[agent-settings GET]', e);
    res.status(500).json({ error: e.message });
  }
});

router.put('/agent-settings', async (req, res) => {
  try {
    const c = SUPER_AGENT_CEILINGS;
    const b = req.body || {};

    const clampNum = (val, ceiling, allowZero = true) => {
      if (val === null || val === undefined || val === '') return allowZero ? 0 : ceiling;
      const n = Math.floor(Number(val));
      if (Number.isNaN(n)) return allowZero ? 0 : ceiling;
      if (n <= 0) return allowZero ? 0 : 1;
      return Math.min(n, ceiling);
    };

    const policyIn = (b.screenshotPolicy && typeof b.screenshotPolicy === 'object') ? b.screenshotPolicy : {};
    const screenshotPolicy = {
      onTaskStart:       !!policyIn.onTaskStart,
      everyNSteps:       Math.min(Math.max(0, Math.floor(Number(policyIn.everyNSteps) || 0)), 50),
      beforeInteraction: !!policyIn.beforeInteraction,
      afterNavigation:   !!policyIn.afterNavigation,
      onError:           !!policyIn.onError,
      onCanvasHeavy:     policyIn.onCanvasHeavy !== false
    };

    const updates = {
      maxSteps: clampNum(b.maxSteps, c.maxSteps),
      maxScreenshotsPerTask: clampNum(b.maxScreenshotsPerTask, c.maxScreenshotsPerTask),
      maxScreenshotsPerStep: clampNum(b.maxScreenshotsPerStep, c.maxScreenshotsPerStep),
      screenshotPolicy,
      customRules: typeof b.customRules === 'string' ? b.customRules.slice(0, 2000) : '',
      memoryEnabled: b.memoryEnabled !== false,
      autoExtractMemories: b.autoExtractMemories !== false,
      maxSubAgents: clampNum(b.maxSubAgents, 10, false),
      sessionPersistenceEnabled: !!b.sessionPersistenceEnabled,
      councilEnabled: b.councilEnabled !== false,
      newWindowForResearch: !!b.newWindowForResearch,
      stepPatternHintsEnabled: b.stepPatternHintsEnabled !== false,
      autoExtensionUpdates: !!b.autoExtensionUpdates
    };

    if (typeof b.temperature === 'number' && b.temperature >= 0 && b.temperature <= 1) {
      updates.temperature = b.temperature;
    } else if (b.temperature === null) {
      updates.temperature = null;
    }

    if (b.councilRoles && typeof b.councilRoles === 'object') {
      const roles = {};
      for (const role of ['strategist', 'executor', 'critic', 'optimizer']) {
        if (typeof b.councilRoles[role] === 'string') {
          roles[role] = b.councilRoles[role].trim().slice(0, 80);
        }
      }
      updates.councilRoles = roles;
    }

    // Council members — new-style array of {id, name, description, model, enabled, isBuiltIn}
    if (Array.isArray(b.councilMembers)) {
      const members = b.councilMembers
        .filter(m => m && typeof m === 'object' && m.id && m.name)
        .map(m => ({
          id: String(m.id || '').slice(0, 60),
          name: String(m.name || '').trim().slice(0, 40),
          description: String(m.description || '').trim().slice(0, 300),
          model: String(m.model || '').trim().slice(0, 120),
          enabled: m.enabled !== false,
          isBuiltIn: !!m.isBuiltIn
        }));
      updates.councilMembers = members;
    }

    // Skill sharing toggles
    if (b.skillSharing && typeof b.skillSharing === 'object') {
      updates.skillSharing = {
        miningEnabled: !!b.skillSharing.miningEnabled,
        publishToGlobalPool: !!b.skillSharing.publishToGlobalPool,
        learnFromGlobalPool: !!b.skillSharing.learnFromGlobalPool,
        allowGreyDownload: !!b.skillSharing.allowGreyDownload,
        allowGreyUpload: !!b.skillSharing.allowGreyUpload,
        blockedDomains: Array.isArray(b.skillSharing.blockedDomains)
          ? b.skillSharing.blockedDomains.filter(d => typeof d === 'string').slice(0, 50)
          : []
      };
    }

    let doc = await db.agentSettings.findByUser(String(req.userId));
    if (!doc) {
      doc = await db.agentSettings.getOrCreate(String(req.userId));
    }
    doc = await db.agentSettings.update(doc._id, updates);

    res.json({ settings: doc });
  } catch (e) {
    console.error('[agent-settings PUT]', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// USER MEMORY
// ============================================================

const VALID_CATS = new Set(['preference', 'account', 'identity', 'payment', 'habit', 'contact', 'rule', 'credential', 'other']);
const SECRET_PAT = /\b(password|card\s?number|cvv|cvc|otp|one[- ]time\s?code|api[_ ]?key)\b/i;

router.get('/memory', async (req, res) => {
  try {
    const memories = await db.userMemory.findByUser(String(req.userId), { status: undefined });
    // Include all statuses for the UI
    const allMemories = await db.userMemory.findByUser(String(req.userId), {});
    res.json({ memories: allMemories });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/memory', async (req, res) => {
  try {
    const { text, category, domain, key } = req.body || {};
    if (!text || typeof text !== 'string' || text.trim().length < 3) {
      return res.status(400).json({ error: 'text is required (3+ chars)' });
    }
    if (SECRET_PAT.test(text)) {
      return res.status(400).json({ error: 'Refusing to store memory containing a secret. Use briefing inputs for passwords/OTPs.' });
    }
    const cat = VALID_CATS.has(category) ? category : 'other';
    const dom = (domain || '').toLowerCase().trim().slice(0, 253);
    if (dom && dom !== '*' && !HOST_RE.test(dom)) {
      return res.status(400).json({ error: 'Invalid domain. Use a hostname like "amazon.com" or "*" for global.' });
    }
    const doc = await db.userMemory.create({
      userId: String(req.userId),
      text: text.trim().slice(0, 1000),
      category: cat,
      domain: dom,
      key: typeof key === 'string' ? key.trim().slice(0, 64) : '',
      confidence: 1,
      createdByAgent: false,
      status: 'active'
    });
    res.status(201).json({ memory: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/memory/:id', async (req, res) => {
  try {
    const { text, category, domain, status } = req.body || {};
    const upd = {};
    if (typeof text === 'string') {
      if (SECRET_PAT.test(text)) return res.status(400).json({ error: 'Refusing to store secrets in memory.' });
      upd.text = text.trim().slice(0, 1000);
    }
    if (category && VALID_CATS.has(category)) upd.category = category;
    if (typeof domain === 'string') {
      const dom = domain.toLowerCase().trim().slice(0, 253);
      if (dom && dom !== '*' && !HOST_RE.test(dom)) return res.status(400).json({ error: 'Invalid domain.' });
      upd.domain = dom;
    }
    if (status && ['active', 'pending', 'archived'].includes(status)) upd.status = status;

    const existing = await db.userMemory.findOne(req.params.id, String(req.userId));
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const doc = await db.userMemory.update(req.params.id, upd);
    res.json({ memory: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/memory/:id', async (req, res) => {
  try {
    const r = await db.userMemory.delete(req.params.id);
    res.json({ deleted: !!r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/memory/:id/confirm', async (req, res) => {
  try {
    const existing = await db.userMemory.findOne(req.params.id, String(req.userId));
    if (!existing) return res.status(404).json({ error: 'Not found or not pending' });
    const doc = await db.userMemory.update(req.params.id, { status: 'active', confidence: 1 });
    res.json({ memory: doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/memory', async (req, res) => {
  try {
    // Bulk wipe — find all and delete each
    const all = await db.userMemory.findByUser(String(req.userId), {});
    let deleted = 0;
    for (const m of all) {
      if (await db.userMemory.delete(m._id)) deleted++;
    }
    res.json({ deleted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// DOMAIN RULES
// ============================================================

router.get('/domain-rules', async (req, res) => {
  try {
    const rules = await db.domainRules.findByUser(String(req.userId));
    res.json({ rules });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/domain-rules', async (req, res) => {
  try {
    const { domain, rule, severity } = req.body || {};
    if (!domain || typeof domain !== 'string') return res.status(400).json({ error: 'domain is required' });
    if (!rule || typeof rule !== 'string' || rule.trim().length < 3) return res.status(400).json({ error: 'rule is required (3+ chars)' });
    const dom = domain.toLowerCase().trim().slice(0, 253);
    if (dom !== '*' && !HOST_RE.test(dom)) return res.status(400).json({ error: 'Invalid domain. Use a hostname like "amazon.com" or "*" for global.' });
    const sev = ['must', 'should', 'info'].includes(severity) ? severity : 'must';
    const doc = await db.domainRules.create({
      userId: String(req.userId),
      domain: dom,
      rule: rule.trim().slice(0, 1000),
      severity: sev,
      enabled: true
    });
    res.status(201).json({ rule: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/domain-rules/:id', async (req, res) => {
  try {
    const { domain, rule, severity, enabled } = req.body || {};
    const upd = {};
    if (typeof domain === 'string') {
      const dom = domain.toLowerCase().trim().slice(0, 253);
      if (dom !== '*' && !HOST_RE.test(dom)) return res.status(400).json({ error: 'Invalid domain.' });
      upd.domain = dom;
    }
    if (typeof rule === 'string' && rule.trim().length >= 3) upd.rule = rule.trim().slice(0, 1000);
    if (['must', 'should', 'info'].includes(severity)) upd.severity = severity;
    if (typeof enabled === 'boolean') upd.enabled = enabled;

    const existing = await db.domainRules.findOne(req.params.id);
    if (!existing || existing.userId !== String(req.userId)) return res.status(404).json({ error: 'Not found' });
    const doc = await db.domainRules.update(req.params.id, upd);
    res.json({ rule: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/domain-rules/:id', async (req, res) => {
  try {
    const r = await db.domainRules.delete(req.params.id);
    res.json({ deleted: !!r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// SCHEDULED TASKS
// ============================================================

const VALID_CRON_RE = /^(\S+\s+){4}\S+$/;

router.get('/scheduled-tasks', async (req, res) => {
  try {
    const tasks = await db.scheduledTasks.findByUser(String(req.userId));
    res.json({ tasks });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/scheduled-tasks', async (req, res) => {
  try {
    const count = await db.scheduledTasks.countByUser(String(req.userId));
    if (count >= SUPER_AGENT_CEILINGS.maxScheduledTasks) {
      return res.status(403).json({ error: `You've reached your scheduled-tasks limit (${SUPER_AGENT_CEILINGS.maxScheduledTasks}).` });
    }
    const { name, prompt, cron, timezone, mode, briefing, permissions } = req.body || {};
    if (!name || !prompt || !cron) return res.status(400).json({ error: 'name, prompt, cron are required' });
    if (!VALID_CRON_RE.test(String(cron).trim())) return res.status(400).json({ error: 'Invalid cron expression (5 fields).' });

    const doc = await db.scheduledTasks.create({
      userId: String(req.userId),
      name: String(name).trim().slice(0, 120),
      prompt: String(prompt).trim().slice(0, 5000),
      cron: String(cron).trim().slice(0, 120),
      timezone: typeof timezone === 'string' ? timezone.trim().slice(0, 64) : 'UTC',
      mode: mode === 'copilot' ? 'copilot' : 'autopilot',
      briefing: briefing && typeof briefing === 'object' ? briefing : {},
      permissions: permissions && typeof permissions === 'object' ? permissions : undefined,
      enabled: true
    });
    res.status(201).json({ task: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/scheduled-tasks/:id', async (req, res) => {
  try {
    const { name, prompt, cron, timezone, mode, briefing, permissions, enabled } = req.body || {};
    const upd = {};
    if (typeof name === 'string') upd.name = name.trim().slice(0, 120);
    if (typeof prompt === 'string') upd.prompt = prompt.trim().slice(0, 5000);
    if (typeof cron === 'string') {
      if (!VALID_CRON_RE.test(cron.trim())) return res.status(400).json({ error: 'Invalid cron.' });
      upd.cron = cron.trim().slice(0, 120);
    }
    if (typeof timezone === 'string') upd.timezone = timezone.trim().slice(0, 64);
    if (mode === 'copilot' || mode === 'autopilot') upd.mode = mode;
    if (briefing && typeof briefing === 'object') upd.briefing = briefing;
    if (permissions && typeof permissions === 'object') upd.permissions = permissions;
    if (typeof enabled === 'boolean') upd.enabled = enabled;

    const existing = await db.scheduledTasks.findOne(req.params.id, String(req.userId));
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const doc = await db.scheduledTasks.update(req.params.id, upd);
    res.json({ task: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/scheduled-tasks/:id', async (req, res) => {
  try {
    const r = await db.scheduledTasks.delete(req.params.id);
    res.json({ deleted: !!r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

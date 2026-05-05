// Integration & Preferences routes — Self-hosted version
// Handles Telegram bot linking, WhatsApp setup, and agent preferences.
// No security middleware, no encryption (self-hosted = user manages own security),
// all users are super_agent tier (background-eligible).

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

// Optional services — only available if the user has configured them
let telegramService, notificationService, agentCommands;
try { telegramService = require('../services/telegramService'); } catch {}
try { notificationService = require('../services/notificationService'); } catch {}
try { agentCommands = require('../services/agentCommands'); } catch {}

const router = express.Router();

// Simple in-memory WhatsApp outbox for self-hosted
const waOutbox = new Map(); // userId → [messages]

function popWAOutbox(userId) {
  const msgs = waOutbox.get(String(userId)) || [];
  waOutbox.set(String(userId), []);
  return msgs;
}

function enqueueWA(userId, text) {
  const arr = waOutbox.get(String(userId)) || [];
  arr.push(text);
  waOutbox.set(String(userId), arr);
}

const WHATSAPP_AGENT_PREFIX = '🤖 ';

// ============================================
// GET /api/integrations — current setup for the user
// ============================================
router.get('/', requireAuth, async (req, res) => {
  try {
    const integ = await db.integrations.getOrCreate(String(req.userId));
    const botId = integ.telegram?.botId || '';
    const webhookUrl = botId ? `https://${req.get('host')}/api/integrations/telegram/webhook/${botId}` : '';
    const fullSetWebhookUrl = botId ? `https://api.telegram.org/bot:BOT_TOKEN/setWebhook?url=${encodeURIComponent(webhookUrl)}` : '';

    res.json({
      backgroundAgent: {
        eligible: true,
        reason: 'Self-hosted server — all features enabled',
        plan: 'super_agent',
        autoRun: true
      },
      telegram: {
        enabled: integ.telegram?.enabled || false,
        configured: !!(integ.telegram?.botToken),
        chatId: integ.telegram?.chatId || '',
        linkCode: integ.telegram?.linkCode || '',
        linkedAt: integ.telegram?.linkedAt || null,
        botUsername: integ.telegram?.botUsername || '',
        webhookUrl,
        fullSetWebhookUrl
      },
      whatsapp: {
        enabled: integ.whatsapp?.enabled || false,
        groupName: integ.whatsapp?.groupName || 'My Agent',
        verified: integ.whatsapp?.verified || false,
        linkedAt: integ.whatsapp?.linkedAt || null
      },
      preferences: integ.preferences || {}
    });
  } catch (err) {
    console.error('[Integrations GET]', err.message);
    res.status(500).json({ error: 'Failed to load integrations' });
  }
});

// ============================================
// PUT /api/integrations/preferences
// ============================================
router.put('/preferences', requireAuth, async (req, res) => {
  try {
    const integ = await db.integrations.getOrCreate(String(req.userId));
    const prefs = integ.preferences || {};

    const allowed = [
      'canCloseTabs', 'autoCloseExceedingLimit', 'preferCurrentTab',
      'notifyChannel', 'notifyOnComplete', 'notifyOnAwaitingUser', 'notifyOnFailure',
      'autoConfirmLowRisk', 'verboseLogging', 'defaultMode', 'preferredAgentModelId'
    ];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        if (k === 'notifyChannel' && !['none', 'telegram', 'whatsapp'].includes(req.body[k])) continue;
        if (k === 'defaultMode' && !['copilot', 'autopilot'].includes(req.body[k])) continue;
        prefs[k] = req.body[k];
      }
    }

    if (req.body.research && typeof req.body.research === 'object') {
      const r = req.body.research;
      prefs.research = prefs.research || {};
      const clamps = {
        minDistinctDomains: [1, 6],
        maxSearchPages:     [1, 5],
        minWebsitesToVisit: [1, 6],
        maxLinksPerWebsite: [0, 6],
        maxPaginatedPages:  [0, 10],
        scrollPasses:       [0, 10]
      };
      for (const [key, [lo, hi]] of Object.entries(clamps)) {
        if (r[key] !== undefined) {
          const n = parseInt(r[key], 10);
          if (Number.isFinite(n)) prefs.research[key] = Math.min(hi, Math.max(lo, n));
        }
      }
      if (typeof r.verifySources === 'boolean') prefs.research.verifySources = r.verifySources;
    }

    await db.integrations.update(integ._id, { preferences: prefs });
    res.json({ ok: true, preferences: prefs });
  } catch (err) {
    console.error('[Prefs PUT]', err.message);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

// ============================================
// POST /api/integrations/telegram/setup
// ============================================
router.post('/telegram/setup', requireAuth, async (req, res) => {
  try {
    const { botToken } = req.body;
    if (!botToken || !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
      return res.status(400).json({ error: 'Invalid bot token format' });
    }

    if (!telegramService?.getMe) {
      return res.status(501).json({ error: 'Telegram service not configured on this server' });
    }

    const me = await telegramService.getMe(botToken);
    if (!me?.ok) return res.status(400).json({ error: 'Token rejected by Telegram', detail: me });

    const botId = botToken.split(':')[0];
    const integ = await db.integrations.getOrCreate(String(req.userId));
    // Self-hosted: store token as plaintext (no encryption)
    const telegram = {
      ...integ.telegram,
      botToken,
      botId,
      botUsername: me.result.username || '',
      linkCode: crypto.randomBytes(4).toString('hex').toUpperCase(),
      enabled: true,
      chatId: '',
      linkedAt: null
    };

    await db.integrations.update(integ._id, { telegram });

    const webhookUrl = `https://${req.get('host')}/api/integrations/telegram/webhook/${botId}`;
    const fullSetWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    res.json({
      ok: true,
      botUsername: telegram.botUsername,
      linkCode: telegram.linkCode,
      instruction: `Open Telegram, find @${telegram.botUsername}, press Start, then send: /link ${telegram.linkCode}`,
      webhookUrl,
      fullSetWebhookUrl
    });
  } catch (err) {
    console.error('[Telegram setup]', err.message);
    res.status(500).json({ error: 'Failed to setup Telegram' });
  }
});

// ============================================
// POST /api/integrations/telegram/unlink
// ============================================
router.post('/telegram/unlink', requireAuth, async (req, res) => {
  const integ = await db.integrations.getOrCreate(String(req.userId));
  await db.integrations.update(integ._id, {
    telegram: { enabled: false, botToken: '', botId: '', chatId: '', linkCode: '', linkedAt: null, botUsername: '', queuedTaskPrompt: '' }
  });
  res.json({ ok: true });
});

// ============================================
// POST /api/integrations/telegram/webhook/:botId
// Public — receives updates from Telegram
// ============================================
router.post('/telegram/webhook/:botId', async (req, res) => {
  res.json({ ok: true }); // Always 200 quickly

  try {
    if (!telegramService?.parseUpdate) return;

    const botId = String(req.params.botId || '').replace(/[^0-9]/g, '');
    if (!botId) return;
    const parsed = telegramService.parseUpdate(req.body);
    if (!parsed) return;

    const integ = await db.integrations.findByBotId(botId);
    if (!integ) return;

    const plainToken = integ.telegram?.botToken || '';
    if (!plainToken) return;

    const text = (parsed.text || '').trim();

    // /link <code>
    if (text.toLowerCase().startsWith('/link ')) {
      const code = text.slice(6).trim().toUpperCase();
      if (code === integ.telegram.linkCode) {
        await db.integrations.update(integ._id, {
          telegram: { ...integ.telegram, chatId: parsed.chatId, linkedAt: new Date().toISOString(), linkCode: '' }
        });
        if (telegramService.sendMessage) {
          await telegramService.sendMessage(plainToken, parsed.chatId,
            '✅ Linked!\n\n' + (agentCommands?.helpText?.() || 'Send /help for commands.'));
        }
      } else {
        if (telegramService.sendMessage) {
          await telegramService.sendMessage(plainToken, parsed.chatId, '❌ Invalid link code.');
        }
      }
      return;
    }

    if (!integ.telegram.chatId || integ.telegram.chatId !== parsed.chatId) {
      if (telegramService.sendMessage) {
        await telegramService.sendMessage(plainToken, parsed.chatId,
          'This bot is not linked to your account, or you are not the linked user.');
      }
      return;
    }

    // Slash commands
    if (text.startsWith('/') && agentCommands?.handleAgentCommand) {
      const cmdResult = await agentCommands.handleAgentCommand({ integ, text, channel: 'telegram' });
      if (cmdResult.queueTask?.prompt) {
        await db.integrations.update(integ._id, {
          telegram: { ...integ.telegram, queuedTaskPrompt: cmdResult.queueTask.prompt }
        });
      }
      if (cmdResult.reply && telegramService.sendMessage) {
        await telegramService.sendMessage(plainToken, parsed.chatId, cmdResult.reply);
      }
      return;
    }

    // Awaiting user reply
    const tasks = await db.agentTasks.findByUser(integ.userId, { status: 'awaiting_user' });
    if (tasks.length > 0) {
      const task = tasks[0];
      const pq = task.pendingQuestion || {};
      pq.lastTelegramReply = text;
      await db.agentTasks.update(task._id, { pendingQuestion: pq, dormancyNoticeSentAt: null });
      if (telegramService.sendMessage) {
        await telegramService.sendMessage(plainToken, parsed.chatId,
          '📨 Reply received. Will be picked up by your active session.');
      }
      return;
    }

    // Running task nudge
    const running = await db.agentTasks.findByUser(integ.userId);
    const activeRunning = running.find(t => ['planning', 'briefing', 'running', 'paused'].includes(t.status));
    if (activeRunning) {
      const nudges = [...(activeRunning.chatNudges || []), { source: 'telegram', text, at: new Date().toISOString() }];
      await db.agentTasks.update(activeRunning._id, { chatNudges: nudges.slice(-20), dormancyNoticeSentAt: null });
      if (telegramService.sendMessage) {
        await telegramService.sendMessage(plainToken, parsed.chatId,
          '💬 Got it — I\'ll pass that to the running task on its next step.');
      }
      return;
    }

    // No active task → queue as new prompt
    const echoSafe = text.substring(0, 200);
    if (telegramService.sendMessage) {
      await telegramService.sendMessage(plainToken, parsed.chatId,
        '📝 Task queued.\n\nYour message: "' + echoSafe + '"\n\nSend /help for all commands.');
    }
    await db.integrations.update(integ._id, {
      telegram: { ...integ.telegram, queuedTaskPrompt: text }
    });
  } catch (err) {
    console.error('[Telegram webhook]', err.message);
  }
});

// ============================================
// GET /api/integrations/inbox
// ============================================
router.get('/inbox', requireAuth, async (req, res) => {
  const integ = await db.integrations.getOrCreate(String(req.userId));
  const tg = integ.telegram?.queuedTaskPrompt || '';
  const wa = integ.whatsapp?.queuedTaskPrompt || '';
  const queuedPrompt = tg || wa;
  const source = tg ? 'telegram' : (wa ? 'whatsapp' : null);

  if (tg || wa) {
    const telegram = { ...integ.telegram, queuedTaskPrompt: '' };
    const whatsapp = { ...integ.whatsapp, queuedTaskPrompt: '' };
    await db.integrations.update(integ._id, {
      telegram,
      whatsapp,
      lastInboxConsumed: { source, prompt: queuedPrompt, at: new Date().toISOString() }
    });
  }

  res.json({
    queuedPrompt,
    source,
    backgroundEligible: true,
    backgroundReason: 'Self-hosted server — all features enabled',
    subscriptionPlan: 'super_agent'
  });
});

// ============================================
// WhatsApp endpoints
// ============================================

router.post('/whatsapp/setup', requireAuth, async (req, res) => {
  const integ = await db.integrations.getOrCreate(String(req.userId));
  const whatsapp = {
    ...integ.whatsapp,
    enabled: true,
    verified: false,
    linkedAt: null,
    groupName: req.body.groupName ? String(req.body.groupName).trim().slice(0, 100) : (integ.whatsapp?.groupName || 'My Agent')
  };
  await db.integrations.update(integ._id, { whatsapp });
  res.json({
    ok: true,
    groupName: whatsapp.groupName,
    instruction: `Open WhatsApp, create a group named "${whatsapp.groupName}" with only yourself, then click "Verify" after WhatsApp Web is loaded.`
  });
});

router.post('/whatsapp/verify', requireAuth, async (req, res) => {
  const integ = await db.integrations.getOrCreate(String(req.userId));
  if (!integ.whatsapp?.enabled) return res.status(400).json({ error: 'WhatsApp not enabled' });
  const whatsapp = { ...integ.whatsapp, verified: true, linkedAt: new Date().toISOString() };
  await db.integrations.update(integ._id, { whatsapp });
  res.json({ ok: true });
});

router.post('/whatsapp/unlink', requireAuth, async (req, res) => {
  const integ = await db.integrations.getOrCreate(String(req.userId));
  await db.integrations.update(integ._id, {
    whatsapp: { enabled: false, groupName: 'My Agent', verified: false, linkedAt: null, lastSeenMessageId: '', queuedTaskPrompt: '' }
  });
  res.json({ ok: true });
});

router.post('/whatsapp/incoming', requireAuth, async (req, res) => {
  try {
    const { text, messageId } = req.body;
    const integ = await db.integrations.getOrCreate(String(req.userId));
    if (!integ.whatsapp?.enabled) return res.status(400).json({ error: 'WhatsApp not enabled' });
    if (messageId && integ.whatsapp.lastSeenMessageId === messageId) {
      return res.json({ ok: true, duplicate: true });
    }
    if (typeof text === 'string' && text.startsWith(WHATSAPP_AGENT_PREFIX)) {
      return res.json({ ok: true, ignored: 'agent_echo' });
    }

    const whatsapp = { ...integ.whatsapp, lastSeenMessageId: messageId || '' };

    // Slash commands
    if ((text || '').trim().startsWith('/') && agentCommands?.handleAgentCommand) {
      const cmdResult = await agentCommands.handleAgentCommand({ integ, text, channel: 'whatsapp' });
      if (cmdResult.queueTask?.prompt) whatsapp.queuedTaskPrompt = cmdResult.queueTask.prompt;
      if (cmdResult.reply) enqueueWA(String(req.userId), WHATSAPP_AGENT_PREFIX + cmdResult.reply);
      await db.integrations.update(integ._id, { whatsapp });
      return res.json({ ok: true, command: true });
    }

    // Awaiting user reply
    const tasks = await db.agentTasks.findByUser(String(req.userId), { status: 'awaiting_user' });
    if (tasks.length > 0) {
      const task = tasks[0];
      const pq = task.pendingQuestion || {};
      pq.lastWhatsAppReply = text;
      await db.agentTasks.update(task._id, { pendingQuestion: pq, dormancyNoticeSentAt: null });
      await db.integrations.update(integ._id, { whatsapp });
      return res.json({ ok: true, reply: true });
    }

    // Running task nudge
    const running = await db.agentTasks.findByUser(String(req.userId));
    const activeRunning = running.find(t => ['planning', 'briefing', 'running', 'paused'].includes(t.status));
    if (activeRunning) {
      const nudges = [...(activeRunning.chatNudges || []), { source: 'whatsapp', text, at: new Date().toISOString() }];
      await db.agentTasks.update(activeRunning._id, { chatNudges: nudges.slice(-20), dormancyNoticeSentAt: null });
      enqueueWA(String(req.userId), WHATSAPP_AGENT_PREFIX + '💬 Got it — I\'ll pass that to the running task.');
      await db.integrations.update(integ._id, { whatsapp });
      return res.json({ ok: true, nudge: true });
    }

    // No active task → queue as new prompt
    whatsapp.queuedTaskPrompt = text;
    enqueueWA(String(req.userId), WHATSAPP_AGENT_PREFIX + '📝 Task queued.\n\nSend /help to see all commands.');
    await db.integrations.update(integ._id, { whatsapp });
    res.json({ ok: true });
  } catch (err) {
    console.error('[WA incoming]', err.message);
    res.status(500).json({ error: 'Failed to ingest WhatsApp message' });
  }
});

router.get('/whatsapp/outbox', requireAuth, async (req, res) => {
  try {
    const messages = popWAOutbox(String(req.userId));
    res.json({ messages });
  } catch (err) {
    console.error('[WA outbox]', err.message);
    res.status(500).json({ error: 'Failed to read outbox', messages: [] });
  }
});

// POST /api/integrations/test
router.post('/test', requireAuth, async (req, res) => {
  const { channel } = req.body || {};
  if (channel === 'whatsapp') {
    enqueueWA(String(req.userId), '✅ Self-hosted test message — WhatsApp channel is working.');
    res.json({ ok: true, channel: 'whatsapp' });
  } else if (channel === 'telegram') {
    const integ = await db.integrations.findByUser(String(req.userId));
    if (integ?.telegram?.botToken && integ?.telegram?.chatId && telegramService?.sendMessage) {
      await telegramService.sendMessage(integ.telegram.botToken, integ.telegram.chatId,
        '✅ Self-hosted test message — Telegram channel is working.');
      res.json({ ok: true, channel: 'telegram' });
    } else {
      res.json({ ok: false, error: 'Telegram not configured' });
    }
  } else {
    res.json({ ok: false, error: 'Specify channel: telegram or whatsapp' });
  }
});

module.exports = router;

// Shared chat-bot command handler — Self-hosted version
// Uses storage abstraction instead of Mongoose. All users = super_agent.

const db = require('../storage');

const ACTIVE_STATUSES = ['planning', 'briefing', 'running', 'awaiting_user', 'paused'];

function shortId(id) {
  return String(id).slice(-6);
}

function helpText() {
  return [
    '🤖 Global Executive — Commands',
    '',
    'Send any natural-language message and I will talk to the active task,',
    'or start a fresh one when none is running.',
    '',
    '/help — This message',
    '/account — Your plan & usage',
    '/tasks — List active tasks',
    '/cancel [id] — Cancel task (or all if no id)',
    '/new-task <prompt> — Queue a new task',
    '/new-task-close <prompt> — Cancel running + queue new',
    '/copilot — Set co-pilot mode (asks before risky steps)',
    '/autopilot — Set auto-pilot mode (runs without asking)',
    '/mode — Show current default mode',
    '/models — List available agent models',
    '/model <id> — Set preferred agent model',
    '/unlink — Disconnect this chat'
  ].join('\n');
}

async function handleAgentCommand({ integ, text, channel }) {
  if (!text || typeof text !== 'string') return { handled: false };
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { handled: false };

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  if (cmd === '/help' || cmd === '/start') {
    return { handled: true, reply: helpText() };
  }

  const userId = String(integ.userId);
  const user = await db.users.findById(userId);
  if (!user) return { handled: true, reply: 'Account not found for this chat.' };

  // ---------- /new-task, /new-task-close ----------
  if (cmd === '/new-task' || cmd === '/newtask' || cmd === '/new-task-close' || cmd === '/newtaskclose') {
    if (!arg) return { handled: true, reply: `Usage: ${cmd} <what you want done>` };
    const closeRunning = cmd === '/new-task-close' || cmd === '/newtaskclose';
    let cancelledCount = 0;
    if (closeRunning) {
      const tasks = await db.agentTasks.findByUser(userId);
      const active = (tasks || []).filter(t => ACTIVE_STATUSES.includes(t.status));
      for (const t of active) {
        await db.agentTasks.update(t._id, { status: 'cancelled', summary: `Cancelled via ${channel} by /new-task-close.` });
        cancelledCount++;
      }
    }
    return {
      handled: true,
      queueTask: { prompt: arg, force: true },
      reply: (closeRunning && cancelledCount ? `🛑 Cancelled ${cancelledCount} task(s).\n` : '') + `📝 New task queued: ${arg.substring(0, 200)}`
    };
  }

  // ---------- /account ----------
  if (cmd === '/account') {
    const prefs = integ.preferences || {};
    return {
      handled: true,
      reply: [
        '👤 Account', '',
        `Email: ${user.email || 'N/A'}`,
        'Plan: super_agent (self-hosted)',
        'Credits: unlimited',
        `Default mode: ${prefs.defaultMode || 'copilot'}`,
        `Preferred model: ${prefs.preferredAgentModelId || '(system default)'}`
      ].join('\n')
    };
  }

  // ---------- /copilot, /autopilot, /mode ----------
  if (cmd === '/copilot' || cmd === '/co-pilot') {
    integ.preferences = integ.preferences || {};
    integ.preferences.defaultMode = 'copilot';
    await db.integrations.update(integ._id, { preferences: integ.preferences });
    return { handled: true, reply: '✅ Default mode set to co-pilot — I will ask before risky steps.' };
  }
  if (cmd === '/autopilot' || cmd === '/auto-pilot') {
    integ.preferences = integ.preferences || {};
    integ.preferences.defaultMode = 'autopilot';
    await db.integrations.update(integ._id, { preferences: integ.preferences });
    return { handled: true, reply: '✅ Default mode set to auto-pilot — I will run without asking questions.' };
  }
  if (cmd === '/mode') {
    return { handled: true, reply: `Current default mode: ${integ.preferences?.defaultMode || 'copilot'}` };
  }

  // ---------- /tasks ----------
  if (cmd === '/tasks' || cmd === '/list') {
    const tasks = await db.agentTasks.findByUser(userId);
    const active = (tasks || []).filter(t => ACTIVE_STATUSES.includes(t.status)).slice(0, 20);
    if (!active.length) return { handled: true, reply: 'You have no active tasks.' };
    const lines = ['📋 Active tasks:', ''];
    for (const t of active) {
      const progress = t.maxSteps ? ` (${t.currentStepNumber || 0}/${t.maxSteps})` : '';
      lines.push(`• [${shortId(t._id)}] ${t.status}${progress} — ${t.title}`);
    }
    lines.push('', 'Use /cancel <id> to stop one, or /cancel to stop all.');
    return { handled: true, reply: lines.join('\n') };
  }

  // ---------- /cancel and /stop ----------
  if (cmd === '/cancel' || cmd === '/stop') {
    const tasks = await db.agentTasks.findByUser(userId);
    const active = (tasks || []).filter(t => ACTIVE_STATUSES.includes(t.status));
    if (arg) {
      const target = active.find(t => String(t._id).toLowerCase().endsWith(arg.toLowerCase()));
      if (!target) return { handled: true, reply: `No active task ending with "${arg}". Send /tasks to see ids.` };
      await db.agentTasks.update(target._id, { status: 'cancelled', summary: `Cancelled via ${channel}.` });
      return { handled: true, reply: `🛑 Cancelled task [${shortId(target._id)}] ${target.title}` };
    }
    if (!active.length) return { handled: true, reply: 'No active tasks to cancel.' };
    for (const t of active) {
      await db.agentTasks.update(t._id, { status: 'cancelled', summary: `Cancelled via ${channel}.` });
    }
    return { handled: true, reply: `🛑 Cancelled ${active.length} task(s).` };
  }

  // ---------- /models ----------
  if (cmd === '/models') {
    const models = await db.models.list();
    const agentModels = (models || []).filter(m => m.isEnabled && m.isAgentModel);
    if (!agentModels.length) return { handled: true, reply: 'No agent-capable models are available right now.' };
    const cur = integ.preferences?.preferredAgentModelId || '';
    const lines = ['🧠 Available agent models:', ''];
    for (const m of agentModels) {
      const flags = [];
      if (m.isDefault) flags.push('default');
      if (m.modelId === cur) flags.push('selected');
      const tag = flags.length ? ` (${flags.join(', ')})` : '';
      lines.push(`• ${m.modelId || m.openRouterId} — ${m.name}${tag}`);
    }
    lines.push('', 'Use /model <modelId> to set your preferred model.');
    return { handled: true, reply: lines.join('\n') };
  }

  // ---------- /model [id] ----------
  if (cmd === '/model') {
    if (!arg) {
      const cur = integ.preferences?.preferredAgentModelId || '(system default)';
      return { handled: true, reply: `Current preferred model: ${cur}\nSend /models to see options.` };
    }
    const models = await db.models.list();
    const m = (models || []).find(m => m.isEnabled && m.isAgentModel && (m.modelId === arg || m.openRouterId === arg));
    if (!m) return { handled: true, reply: `Unknown agent model "${arg}". Send /models to list them.` };
    integ.preferences = integ.preferences || {};
    integ.preferences.preferredAgentModelId = m.modelId || m.openRouterId;
    await db.integrations.update(integ._id, { preferences: integ.preferences });
    return { handled: true, reply: `✅ Preferred agent model set to ${m.name} (${m.modelId || m.openRouterId}).` };
  }

  // ---------- /unlink ----------
  if (cmd === '/unlink' || cmd === '/disconnect') {
    const updates = {};
    if (channel === 'telegram') {
      updates.telegram = { enabled: false, botToken: '', botId: '', chatId: '', linkCode: '', linkedAt: null, botUsername: '' };
    } else if (channel === 'whatsapp') {
      updates.whatsapp = { enabled: false, verified: false, linkedAt: null, lastSeenMessageId: '' };
    }
    await db.integrations.update(integ._id, updates);
    return { handled: true, reply: '✅ Disconnected. Send /help in the dashboard to relink.' };
  }

  return { handled: true, reply: `Unknown command "${cmd}". Send /help to see what I can do.` };
}

module.exports = { handleAgentCommand, helpText, ACTIVE_STATUSES };

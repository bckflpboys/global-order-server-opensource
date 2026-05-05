// Global Executive — Scheduled Task Runner
// Tiny in-process cron worker. No external deps — implements just enough
// of 5-field cron syntax to handle "every X minutes/hours/day/weekday".
//
// We tick every 60 seconds. On each tick:
//   1. Find every enabled ScheduledTask whose nextRunAt <= now (or null).
//   2. For each due task, instantiate a fresh AgentTask in 'pending'
//      state so the user's normal step loop (or a future autopilot
//      runner) picks it up.
//   3. Compute the NEXT firing time and persist nextRunAt.
//
// IMPORTANT: this is a single-instance runner. If you horizontally scale
// the API server, gate this behind RUN_SCHEDULER=1 on exactly one node.

const db = require('../storage');
const { getUserAgentTier } = require('./agentTiers');

// ============================================================
// Minimal 5-field cron parser. Supports:
//   - numeric fields:        "5"
//   - wildcards:             "*"
//   - ranges:                "1-5"
//   - step values:           "*/15", "0-30/2"
//   - comma lists:           "0,15,30,45"
//
// Field order: minute hour day-of-month month day-of-week (0 = Sunday).
// All times are interpreted in UTC (timezone field on the doc is for
// display only — keeping this simple for v1).
// ============================================================
function parseField(spec, min, max) {
  const tokens = spec.split(',');
  const out = new Set();
  for (const tok of tokens) {
    let step = 1;
    let body = tok;
    if (tok.includes('/')) {
      const [b, s] = tok.split('/');
      body = b;
      step = parseInt(s, 10);
      if (!Number.isFinite(step) || step <= 0) throw new Error('bad step');
    }
    let lo, hi;
    if (body === '*') { lo = min; hi = max; }
    else if (body.includes('-')) {
      const [a, b] = body.split('-').map(n => parseInt(n, 10));
      lo = a; hi = b;
    } else {
      const v = parseInt(body, 10);
      lo = v; hi = v;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('bad field');
    for (let i = lo; i <= hi; i += step) {
      if (i >= min && i <= max) out.add(i);
    }
  }
  return out;
}

function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('cron must have 5 fields');
  return {
    minute: parseField(parts[0], 0, 59),
    hour:   parseField(parts[1], 0, 23),
    dom:    parseField(parts[2], 1, 31),
    month:  parseField(parts[3], 1, 12),
    dow:    parseField(parts[4], 0, 6)
  };
}

// Compute the next moment >= `from` (exclusive of `from` if `from` itself
// matches and `inclusive` = false) when the cron matches. Bounded scan:
// stop after 4 years to avoid infinite loops on impossible expressions.
function nextRun(cron, from) {
  const start = new Date(from.getTime() + 60_000); // earliest = next minute
  start.setUTCSeconds(0, 0);
  const limit = start.getTime() + 4 * 365 * 24 * 60 * 60_000;
  let t = start;
  while (t.getTime() < limit) {
    const m = t.getUTCMinutes();
    const h = t.getUTCHours();
    const d = t.getUTCDate();
    const mo = t.getUTCMonth() + 1;
    const dw = t.getUTCDay();
    if (
      cron.month.has(mo) &&
      cron.dom.has(d) &&
      cron.dow.has(dw) &&
      cron.hour.has(h) &&
      cron.minute.has(m)
    ) {
      return t;
    }
    t = new Date(t.getTime() + 60_000);
  }
  return null;
}

// ============================================================
// Pick due tasks and enqueue them.
// ============================================================
async function tick() {
  const now = new Date();
  let due;
  try {
    const all = await db.scheduledTasks.findEnabled();
    due = (all || []).filter(st => st.enabled && (!st.nextRunAt || new Date(st.nextRunAt) <= now)).slice(0, 50);
  } catch (e) {
    console.warn('[ScheduleRunner] find failed:', e.message);
    return;
  }

  for (const st of due) {
    let parsedCron;
    try { parsedCron = parseCron(st.cron); }
    catch (e) {
      // Bad cron — disable + record error so the user can see it.
      await db.scheduledTasks.update(st._id, { enabled: false, lastRunStatus: 'failed', lastRunError: 'Invalid cron: ' + e.message, nextRunAt: null });
      continue;
    }

    // First-ever run: nextRunAt was null. Set it forward and skip this tick
    // (avoid running immediately on first save — wait for the first natural
    // firing).
    if (!st.nextRunAt) {
      const next = nextRun(parsedCron, now);
      await db.scheduledTasks.update(st._id, { nextRunAt: next });
      continue;
    }

    // Verify user still exists + has tier permission before spawning.
    const user = await db.users.findById(String(st.userId));
    if (!user) {
      await db.scheduledTasks.update(st._id, { enabled: false });
      continue;
    }
    const { tier } = getUserAgentTier(user);
    if (!tier.canScheduleTasks) {
      await db.scheduledTasks.update(st._id, { enabled: false, lastRunStatus: 'cancelled', lastRunError: 'Tier no longer allows scheduled tasks.' });
      continue;
    }

    // === Spawn the agent task in 'pending' state ===
    let newTask;
    try {
      newTask = await db.agentTasks.create({
        userId: String(st.userId),
        title: (st.name || '').slice(0, 120),
        originalPrompt: st.prompt,
        mode: st.mode || 'autopilot',
        briefing: st.briefing || {},
        permissions: st.permissions || {},
        source: st.source || 'web',
        status: 'pending',
        scheduledTaskId: st._id,
        triggeredBy: 'schedule'
      });
    } catch (e) {
      console.warn('[ScheduleRunner] task create failed:', e.message);
      await db.scheduledTasks.update(st._id, { lastRunStatus: 'failed', lastRunError: e.message });
      continue;
    }

    // Advance nextRunAt + bump counters.
    const nextRunAtDate = st.nextRunAt instanceof Date ? st.nextRunAt : new Date(st.nextRunAt);
    const advancedFrom = new Date(Math.max(nextRunAtDate.getTime(), now.getTime()));
    const next = nextRun(parsedCron, advancedFrom);
    await db.scheduledTasks.update(st._id, {
      nextRunAt: next, lastRunAt: now, lastTaskId: newTask._id,
      lastRunStatus: 'success', lastRunError: '', runCount: (st.runCount || 0) + 1
    });

    console.log(`[ScheduleRunner] Spawned task ${newTask._id} from schedule ${st._id} (user ${String(st.userId)})`);
  }
}

// ============================================================
// Public entry — start the loop. Idempotent.
// ============================================================
let _interval = null;
function start({ intervalMs = 60_000 } = {}) {
  if (_interval) return;
  // Run once shortly after startup so brand-new schedules get nextRunAt
  // populated quickly, then on the regular cadence.
  setTimeout(() => { tick().catch(e => console.warn('[ScheduleRunner] initial tick error:', e.message)); }, 5_000);
  _interval = setInterval(() => {
    tick().catch(e => console.warn('[ScheduleRunner] tick error:', e.message));
  }, intervalMs);
  console.log(`[ScheduleRunner] started (tick every ${intervalMs / 1000}s)`);
}

function stop() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}

module.exports = { start, stop, tick, parseCron, nextRun };

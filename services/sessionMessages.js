// Session-persistence message counter + tier-cap gate.
// Self-hosted version: super_agent tier has unlimited session messages,
// so all functions are simplified pass-throughs.

const db = require('../storage');

const MAX_CHAIN = 30;

// Walk the chain and count user messages. For self-hosted, this is
// informational only — there's no cap.
async function countSessionMessages(anyTask, userId) {
  if (!anyTask) return 0;
  const seen = new Set();
  const backward = [];
  let cur = anyTask;
  while (cur && backward.length < MAX_CHAIN) {
    const id = String(cur._id);
    if (seen.has(id)) break;
    seen.add(id);
    backward.push(cur);
    if (!cur.resumedFromId) break;
    try {
      cur = await db.agentTasks.findById(String(cur.resumedFromId));
    } catch { break; }
  }

  const chain = backward.reverse();
  let count = 0;
  for (const t of chain) {
    if (t.originalPrompt) count++;
    count += (t.chatNudges || []).length;
  }
  return count;
}

// Self-hosted: always allowed (super_agent = unlimited)
async function canSendSessionMessage(anyTask, userId, tierConfig) {
  return { allowed: true, current: await countSessionMessages(anyTask, userId), max: 0 };
}

function sessionLimitMessage(tierConfig) {
  return 'Self-hosted server — session messages are unlimited.';
}

module.exports = { countSessionMessages, canSendSessionMessage, sessionLimitMessage };

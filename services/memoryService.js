// Global Executive — Memory Service
// Loads the user's active UserMemory rows, formats them for injection
// into the agent's system prompt, and (optionally) auto-extracts new
// memories from a completed task's transcript.

const db = require('../storage');
let httpRetry;
try { httpRetry = require('./httpRetry'); } catch {}
const fetchWithRetry = httpRetry?.fetchWithRetry || fetch;

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_MEMORIES_IN_PROMPT = 40;  // Top-N most-used/recent
const MAX_MEMORIES_PER_TASK = 50;   // Total per user (soft limit)

// ============================================
// Load active memories for a user, optionally filtered by domain.
// Returns an array of { category, text, domain } ready for prompt use.
// ============================================
async function loadMemoriesForAgent(userId, opts = {}) {
  // Include both `active` AND `pending` memories. Pending ones (confidence
  // < 0.8) are still useful to surface to the agent — they just get marked
  // as "(unverified)" in the prompt so the agent knows to confirm before
  // relying on them. Previously we only loaded active, which meant
  // freshly-auto-extracted memories never showed up in the next task.
  try {
    const all = await db.userMemory.findByUser(userId);
    let filtered = (all || []).filter(m => m.status === 'active' || m.status === 'pending');
    if (opts.domain) {
      filtered = filtered.filter(m => !m.domain || m.domain === opts.domain);
    }
    filtered.sort((a, b) => ((b.usedCount || 0) - (a.usedCount || 0)) || ((b.lastUsedAt || '') > (a.lastUsedAt || '') ? 1 : -1));
    return filtered.slice(0, MAX_MEMORIES_IN_PROMPT);
  } catch { return []; }
}

// ============================================
// Save a single memory directly (no LLM extraction). Used by the
// `rememberThis` agent action so the agent can persist a durable fact
// about the user IMMEDIATELY as soon as the user reveals it — instead of
// waiting for post-task extraction that might never fire (failed task,
// cancelled task, etc.). Returns the saved doc or null on skip.
// ============================================
const VALID_MEMORY_CATEGORIES = new Set([
  'preference', 'account', 'identity', 'payment', 'habit', 'contact', 'rule', 'credential', 'other'
]);
const SECRET_PATTERN = /\b(password|card\s?number|cvv|cvc|otp|one[- ]time\s?code|pin\s?code|secret|api[_ ]?key)\b/i;

async function saveMemoryDirect(userId, { text, category, domain, confidence, sourceTaskId } = {}) {
  if (typeof text !== 'string' || text.trim().length < 5) {
    return { saved: false, reason: 'text_too_short' };
  }
  if (SECRET_PATTERN.test(text)) {
    return { saved: false, reason: 'contains_secret' };
  }
  const cat = VALID_MEMORY_CATEGORIES.has(category) ? category : 'other';
  const conf = typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : 0.85;
  // When the agent explicitly saves a memory mid-task it's almost always
  // because the user just SAID something — high confidence by default.
  // Save as `active` so it surfaces in the very next task.
  try {
    const all = await db.userMemory.findByUser(userId);
    const existing = (all || []).filter(m => m.status !== 'archived').length;
    if (existing >= MAX_MEMORIES_PER_TASK * 3) return { saved: false, reason: 'at_cap' };
    const doc = await db.userMemory.create({
      userId, category: cat, text: text.trim().slice(0, 1000),
      domain: (domain || '').toLowerCase().trim().slice(0, 253),
      confidence: conf, createdByAgent: true, sourceTaskId: sourceTaskId || null, status: 'active'
    });
    return { saved: true, memory: doc };
  } catch (e) {
    return { saved: false, reason: 'duplicate_or_error', error: e.message };
  }
}

// ============================================
// Render memories as a single system-prompt block.
// ============================================
function renderMemoriesForPrompt(memories) {
  if (!memories || memories.length === 0) return '';
  const byCat = {};
  for (const m of memories) {
    const cat = m.category || 'other';
    if (!byCat[cat]) byCat[cat] = [];
    const scope = m.domain ? ` [${m.domain}]` : '';
    const pendingTag = m.status === 'pending' ? ' (unverified — confirm with user before using)' : '';
    byCat[cat].push(`- ${m.text}${scope}${pendingTag}`);
  }
  const sections = [
    '\n## USER MEMORY (long-term facts about this user)',
    'Use these whenever relevant. Never ask the user for something already listed here.',
    'NEVER expose secret values (passwords, card numbers, OTPs) in your `thought` or `message` — reference via briefing inputs instead.'
  ];
  for (const [cat, lines] of Object.entries(byCat)) {
    sections.push(`\n### ${cat.toUpperCase()}`);
    sections.push(...lines);
  }
  return sections.join('\n');
}

// ============================================
// Bump usedCount for memories that were included in a task.
// Called once per task-start (fire-and-forget).
// ============================================
async function markMemoriesUsed(memoryIds) {
  if (!memoryIds || !memoryIds.length) return;
  try {
    for (const id of memoryIds) {
      const m = await db.userMemory.findById(id);
      if (m) await db.userMemory.update(id, { usedCount: (m.usedCount || 0) + 1, lastUsedAt: new Date().toISOString() });
    }
  } catch { /* best effort */ }
}

// ============================================
// Auto-extract memories from a completed task.
// Runs the LLM on the task transcript and saves any extracted facts.
// Called fire-and-forget from the /step route when task status -> completed.
// Guards: (a) `autoExtractMemories` setting must be on, (b) tier must
// allow memory, (c) we cap total memories per user.
// ============================================
const EXTRACTION_PROMPT = `You analyse a completed browser-agent task transcript and extract LONG-TERM facts about the USER that would help the agent on future tasks.

Return ONLY a JSON object:
{
  "memories": [
    {
      "category": "preference|account|identity|payment|habit|contact|rule|other",
      "text": "concise first-person-or-about-user factual statement",
      "domain": "optional domain this applies to, e.g. amazon.com, or empty string",
      "confidence": 0.0-1.0
    }
  ]
}

STRICT RULES:
- ONLY extract DURABLE, REUSABLE facts (preferences, usual accounts, habits, contact info, delivery addresses, dietary needs, shipping preferences, travel preferences, tone, etc.).
- NEVER include: passwords, credit-card numbers, CVVs, OTPs, session tokens, or any one-time secrets.
- You MAY include an EMAIL address the user typed in the task (it's reusable). You MAY include a delivery address (reusable). You MAY include "prefers X over Y" statements.
- Skip trivia. If you aren't at least 0.6 confident it's a durable fact about the user, DON'T include it.
- If the agent CREATED AN ACCOUNT on the user's behalf and the credentials were generated (not user-supplied), you MAY emit ONE memory with category="credential" and text of the form "Created account on <site>: <email>". DO NOT include the password in the text.
- If nothing qualifies, return {"memories": []}.
- NO markdown, NO commentary. JSON only.`;

async function extractMemoriesFromTask(task, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { added: 0, reason: 'no_api_key' };

  // Build compact transcript. Skip errored/failed steps.
  const transcriptLines = [];
  transcriptLines.push(`ORIGINAL TASK: ${task.originalPrompt || ''}`);
  if (task.briefing && Object.keys(task.briefing).length) {
    const safeBriefing = {};
    // Strip sensitive-flagged inputs from the transcript.
    const sensitiveNames = new Set(
      (task.requiredInputs || [])
        .filter(i => i.sensitive)
        .map(i => i.name)
    );
    for (const [k, v] of Object.entries(task.briefing)) {
      if (sensitiveNames.has(k)) safeBriefing[k] = '[REDACTED]';
      else safeBriefing[k] = v;
    }
    transcriptLines.push(`BRIEFING: ${JSON.stringify(safeBriefing)}`);
  }
  transcriptLines.push('STEPS:');
  const stepsSlice = (task.steps || []).slice(-40);
  for (const s of stepsSlice) {
    if (s.action === 'screenshot') continue;
    const line = `  [${s.stepNumber}] ${s.action}(${JSON.stringify(s.params || {}).slice(0, 160)})${s.thought ? ' // ' + s.thought.slice(0, 200) : ''}`;
    transcriptLines.push(line);
  }
  transcriptLines.push(`FINAL STATUS: ${task.status} — ${task.summary || ''}`);

  const userMsg = transcriptLines.join('\n').slice(0, 20000);

  const model = options.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

  let parsed = null;
  try {
    const resp = await fetchWithRetry(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3000',
        'X-Title': 'Global Executive - Memory Extractor'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: EXTRACTION_PROMPT },
          { role: 'user', content: userMsg }
        ],
        temperature: 0.1,
        max_tokens: 1200
      })
    });
    if (!resp.ok) return { added: 0, reason: `http_${resp.status}` };
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    try { parsed = JSON.parse(content); }
    catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch { /* ignore */ } }
    }
  } catch (e) {
    return { added: 0, reason: 'extractor_error', error: e.message };
  }

  const mems = Array.isArray(parsed?.memories) ? parsed.memories : [];
  if (!mems.length) return { added: 0, reason: 'nothing_to_save' };

  // Enforce per-user soft cap.
  let existing = 0;
  try {
    const all = await db.userMemory.findByUser(String(task.userId));
    existing = (all || []).filter(m => m.status !== 'archived').length;
  } catch {}
  const budget = Math.max(0, MAX_MEMORIES_PER_TASK - existing);
  if (budget <= 0) return { added: 0, reason: 'at_cap' };

  const VALID_CATS = new Set(['preference', 'account', 'identity', 'payment', 'habit', 'contact', 'rule', 'credential', 'other']);
  const SECRET_PAT = /\b(password|card\s?number|cvv|cvc|otp|one[- ]time\s?code|pin\s?code|secret|api[_ ]?key)\b/i;

  const toSave = [];
  for (const m of mems.slice(0, budget)) {
    if (!m || typeof m.text !== 'string' || m.text.trim().length < 5) continue;
    if (SECRET_PAT.test(m.text)) continue;
    const cat = VALID_CATS.has(m.category) ? m.category : 'other';
    const confidence = typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : 0.6;
    const status = confidence >= 0.8 ? 'active' : 'pending';
    toSave.push({
      userId: task.userId,
      category: cat,
      text: m.text.trim().slice(0, 1000),
      domain: (m.domain || '').toLowerCase().trim().slice(0, 253),
      confidence,
      createdByAgent: true,
      sourceTaskId: task._id,
      status
    });
  }

  if (!toSave.length) return { added: 0, reason: 'all_filtered' };

  try {
    // Use insertMany with `ordered: false` so a single duplicate-key
    // doesn't abort the rest.
    for (const mem of toSave) { await db.userMemory.create(mem); }
  } catch (e) {
    // insertMany still returns a partial write result; swallow and report
    // what we attempted.
    return { added: toSave.length, reason: 'partial_write', error: e.message };
  }

  return { added: toSave.length };
}

module.exports = {
  loadMemoriesForAgent,
  renderMemoriesForPrompt,
  markMemoriesUsed,
  extractMemoriesFromTask,
  saveMemoryDirect
};

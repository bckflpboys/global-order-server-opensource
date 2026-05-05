// Global Executive — Domain Rule Service
// Loads per-domain rules the user defined and renders them as a system-
// prompt block tailored to the current active tab's hostname.

const db = require('../storage');

// ============================================
// Parse a hostname from a URL, lowercased & trimmed. Returns '' on failure.
// ============================================
function hostnameOf(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    return (u.hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

// ============================================
// Return true if a rule's `domain` pattern matches the given hostname.
// Pattern semantics:
//   "*"               → any hostname
//   "www.amazon.com"  → exact match only
//   "amazon.com"      → amazon.com itself OR any subdomain (foo.amazon.com)
// ============================================
function domainMatches(pattern, hostname) {
  if (!pattern || !hostname) return false;
  if (pattern === '*') return true;
  if (pattern === hostname) return true;
  // Subdomain match when pattern does NOT start with a sub-host segment.
  // i.e. "amazon.com" matches "foo.amazon.com" but "www.amazon.com" does not
  // match "amazon.com".
  if (pattern.split('.').length < hostname.split('.').length) {
    return hostname.endsWith('.' + pattern);
  }
  return false;
}

// ============================================
// Load all enabled rules matching the active tab's hostname.
// Also always includes "*" (global) rules.
// ============================================
async function loadRulesForHostname(userId, hostname) {
  try {
    const all = await db.domainRules.findByUser(userId);
    return (all || []).filter(r => r.enabled && domainMatches(r.domain, hostname));
  } catch { return []; }
}

// ============================================
// Render rules for the system prompt. `must` rules get hard-constraint
// language; `should` rules get preference language; `info` rules get
// background language.
// ============================================
function renderRulesForPrompt(rules, hostname) {
  if (!rules || rules.length === 0) return '';
  const must = rules.filter(r => r.severity === 'must');
  const should = rules.filter(r => r.severity === 'should');
  const info = rules.filter(r => r.severity === 'info');

  const lines = [`\n## USER'S RULES FOR ${hostname || 'this site'}`];
  if (must.length) {
    lines.push('\n### HARD CONSTRAINTS (MUST obey — violating these cancels the task)');
    must.forEach(r => lines.push(`- ${r.rule}${r.domain !== '*' ? '' : ' (applies to every site)'}`));
  }
  if (should.length) {
    lines.push('\n### STRONG PREFERENCES');
    should.forEach(r => lines.push(`- ${r.rule}`));
  }
  if (info.length) {
    lines.push('\n### CONTEXT');
    info.forEach(r => lines.push(`- ${r.rule}`));
  }
  return lines.join('\n');
}

module.exports = {
  hostnameOf,
  domainMatches,
  loadRulesForHostname,
  renderRulesForPrompt
};

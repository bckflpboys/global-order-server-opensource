// Global Executive — Web Search Service
// Server-side SERP fetch for the agent's `webSearch` action.
//
// Why server-side? Doing a web search from inside the user's tab burns at
// least 2 agent steps (navigate to SERP, readPage, parse) and returns a
// token-heavy DOM. Doing it server-side returns a compact, clean list of
// { title, url, snippet } entries in ONE step, and lets us count distinct
// domains for the research-gate.
//
// Providers (tried in order, first success wins):
//   1. Brave Search API  — if BRAVE_SEARCH_API_KEY is set. Best quality.
//   2. SerpAPI (Google)  — if SERPAPI_KEY is set.
//   3. DuckDuckGo HTML   — no key, scraped. Fallback; sometimes rate-limited.
//
// No third-party dependencies; pure `fetch` + regex parsing.

const { fetchWithRetry } = require('./httpRetry');

const MAX_RESULTS = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36';

// ============================================
// Domain helper — used by both this service AND researchNote dedup.
// ============================================
function domainOf(url) {
  try {
    const u = new URL(String(url));
    return u.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

// ============================================
// Provider 1 — Brave Search API
// Docs: https://api.search.brave.com/app/documentation
// ============================================
async function braveSearch(query, count, page) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return null;
  // Brave uses an `offset` of pages of 20; we offset by (page-1)*count.
  const offset = Math.max(0, (page - 1)) * count;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&offset=${offset}&safesearch=moderate`;
  const resp = await fetchWithRetry(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': key }
  }, { maxAttempts: 2 });
  if (!resp.ok) throw new Error(`Brave ${resp.status}`);
  const data = await resp.json();
  const items = (data?.web?.results || []).slice(0, count).map(r => ({
    title: String(r.title || '').slice(0, 240),
    url: String(r.url || ''),
    snippet: String(r.description || r.snippet || '').replace(/<[^>]+>/g, '').slice(0, 400),
    domain: domainOf(r.url),
    age: r.age || ''
  }));
  return { provider: 'brave', results: items };
}

// ============================================
// Provider 2 — SerpAPI (Google)
// ============================================
async function serpapiSearch(query, count, page) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
  const start = Math.max(0, (page - 1)) * count;
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=${count}&start=${start}&api_key=${key}`;
  const resp = await fetchWithRetry(url, { method: 'GET' }, { maxAttempts: 2 });
  if (!resp.ok) throw new Error(`SerpAPI ${resp.status}`);
  const data = await resp.json();
  const items = (data?.organic_results || []).slice(0, count).map(r => ({
    title: String(r.title || '').slice(0, 240),
    url: String(r.link || ''),
    snippet: String(r.snippet || '').slice(0, 400),
    domain: domainOf(r.link),
    age: r.date || ''
  }));
  return { provider: 'google', results: items };
}

// ============================================
// Provider 3 — DuckDuckGo HTML (no key, best-effort scrape).
// Uses the "lite" endpoint which is stable and parseable with regex.
// ============================================
async function duckduckgoSearch(query, count, page) {
  // DuckDuckGo HTML uses `s=<offset>` for pagination (offset in 30-result chunks).
  const offset = Math.max(0, (page - 1)) * count;
  const pagedSuffix = offset > 0 ? `&s=${offset}&dc=${offset}` : '';
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${pagedSuffix}`;
  const resp = await fetchWithRetry(url, {
    method: 'GET',
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  }, { maxAttempts: 2 });
  if (!resp.ok) throw new Error(`DuckDuckGo ${resp.status}`);
  const html = await resp.text();

  // Each result on the HTML endpoint is inside <a class="result__a" href="...">title</a>
  // with a following <a class="result__snippet">...</a>. We capture them with one
  // non-greedy regex scan.
  const results = [];
  const rx = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) !== null && results.length < count) {
    let rawUrl = m[1];
    // DuckDuckGo sometimes wraps URLs as /l/?uddg=<encoded>. Unwrap it.
    try {
      if (rawUrl.startsWith('//duckduckgo.com/l/') || rawUrl.startsWith('/l/')) {
        const u = new URL(rawUrl.startsWith('//') ? 'https:' + rawUrl : 'https://duckduckgo.com' + rawUrl);
        const real = u.searchParams.get('uddg');
        if (real) rawUrl = decodeURIComponent(real);
      }
    } catch { /* ignore */ }
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim();
    if (!rawUrl || !title) continue;
    results.push({
      title: title.slice(0, 240),
      url: rawUrl,
      snippet: snippet.slice(0, 400),
      domain: domainOf(rawUrl),
      age: ''
    });
  }
  return { provider: 'duckduckgo', results };
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ============================================
// Public: search(query, opts) — tries providers in priority order.
// Returns { provider, results: [{title, url, snippet, domain, age}], distinctDomains }.
// Throws on total failure.
// ============================================
async function search(query, opts = {}) {
  const count = Math.min(Math.max(parseInt(opts.count, 10) || 8, 3), MAX_RESULTS);
  const page = Math.min(Math.max(parseInt(opts.page, 10) || 1, 1), 5);
  const q = String(query || '').trim();
  if (!q) throw new Error('webSearch requires a non-empty query.');

  const providers = [braveSearch, serpapiSearch, duckduckgoSearch];
  const errors = [];
  for (const p of providers) {
    try {
      const out = await p(q, count, page);
      if (out && Array.isArray(out.results) && out.results.length) {
        const domains = new Set(out.results.map(r => r.domain).filter(Boolean));
        return {
          provider: out.provider,
          query: q,
          page,
          count: out.results.length,
          distinctDomains: domains.size,
          results: out.results
        };
      }
      if (out) errors.push(`${p.name}: 0 results`);
    } catch (e) {
      errors.push(`${p.name}: ${e.message}`);
    }
  }
  throw new Error(`All search providers failed: ${errors.join('; ') || 'no provider configured'}`);
}

// ============================================
// verifyClaim(url, claim) — fetches the URL and checks whether the
// claim's distinctive keywords appear in the page text. Returns one of:
//   { status: 'verified',     detail: '<n>/<m> key terms matched' }
//   { status: 'partial',      detail: '<n>/<m> key terms matched' }
//   { status: 'not_found',    detail: 'no key terms matched' }
//   { status: 'fetch_failed', detail: '<reason>' }
//
// We deliberately keep this CHEAP and best-effort:
//   - 6s timeout, max 1 MB downloaded
//   - text/html only (binary content auto-fails to fetch_failed)
//   - simple stop-word stripped tokenisation
//   - case-insensitive substring match (no NLP, no embeddings)
//
// This catches the most common citation hallucination — a URL that
// returns 200 but whose page genuinely doesn't contain the claim. It
// will NOT catch a paraphrased claim from a JS-rendered SPA where the
// initial HTML is a shell. That's an acceptable trade-off vs. running
// a full headless browser per note.
// ============================================
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'as', 'by', 'from',
  'that', 'this', 'these', 'those', 'it', 'its', 'has', 'have', 'had', 'will',
  'would', 'could', 'should', 'may', 'might', 'do', 'does', 'did', 'not',
  'no', 'so', 'if', 'than', 'then', 'into', 'about', 'over', 'under', 'per'
]);

function extractKeyTerms(claim) {
  // Split on non-letter/digit, lowercase, drop stopwords and short tokens,
  // dedupe. Cap at 12 terms so we don't spend forever on a long claim.
  const tokens = String(claim || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u017f\s]/gi, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
  const seen = new Set();
  const out = [];
  for (const t of tokens) {
    if (!seen.has(t)) { seen.add(t); out.push(t); }
    if (out.length >= 12) break;
  }
  return out;
}

async function verifyClaim(url, claim) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { status: 'fetch_failed', detail: 'invalid url' };
  }
  const terms = extractKeyTerms(claim);
  if (!terms.length) {
    return { status: 'fetch_failed', detail: 'claim too short to verify' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    if (!resp.ok) {
      return { status: 'fetch_failed', detail: `HTTP ${resp.status}` };
    }
    const ctype = String(resp.headers.get('content-type') || '');
    if (ctype && !/html|text|xml|json/i.test(ctype)) {
      return { status: 'fetch_failed', detail: `non-text content (${ctype.split(';')[0]})` };
    }
    // Stream-cap to 1 MB to avoid pulling down huge pages.
    const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
    let html = '';
    if (reader) {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      let received = 0;
      const MAX = 1024 * 1024;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        html += decoder.decode(value, { stream: true });
        if (received >= MAX) { try { await reader.cancel(); } catch { /* noop */ } break; }
      }
      html += decoder.decode();
    } else {
      html = (await resp.text()).slice(0, 1024 * 1024);
    }
    const text = stripTags(html).toLowerCase();
    let hits = 0;
    for (const t of terms) if (text.includes(t)) hits += 1;
    const ratio = hits / terms.length;
    if (ratio >= 0.7) return { status: 'verified', detail: `${hits}/${terms.length} key terms matched` };
    if (ratio >= 0.4) return { status: 'partial',  detail: `${hits}/${terms.length} key terms matched` };
    return { status: 'not_found', detail: `${hits}/${terms.length} key terms matched` };
  } catch (e) {
    if (e.name === 'AbortError') return { status: 'fetch_failed', detail: 'timeout (>6s)' };
    return { status: 'fetch_failed', detail: e.message || 'unknown error' };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { search, domainOf, verifyClaim };

// Global Executive — HTTP Retry Helper
// Wraps `fetch` with exponential backoff for the transient-error classes
// most LLM providers (OpenRouter, OpenAI, Anthropic) emit:
//   - 408 (request timeout)
//   - 425 (too early)
//   - 429 (rate-limited)
//   - 500 / 502 / 503 / 504 (server overloads)
//   - network errors (TypeError thrown by fetch)
//
// Non-retryable: 4xx other than the above (the request is malformed or
// auth is wrong — retrying just burns time + credits).

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 800;   // first backoff
const DEFAULT_MAX_DELAY_MS  = 8000;  // ceiling per attempt
// Per-attempt hard timeout. Must be SHORTER than whatever reverse-proxy
// (nginx `proxy_read_timeout`, Cloudflare 100s, etc.) sits in front of
// this Node process — otherwise the proxy 504s before our retry logic
// gets a chance to run. 25s gives free models a fair chance while staying
// well under the typical 60s nginx default.
const DEFAULT_TIMEOUT_MS = 25000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// `respectRetryAfter` = true means we honour a `Retry-After` header
// (seconds OR HTTP-date). We cap it at 30s to avoid hanging the request
// for long stretches.
function computeBackoff(attempt, headers, baseMs, maxMs) {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt - 1));
  // Add ±25% jitter so we don't synchronise retries across concurrent calls.
  const jitter = exp * 0.25 * (Math.random() * 2 - 1);
  let delay = Math.max(100, Math.floor(exp + jitter));
  try {
    const ra = headers && headers.get && headers.get('retry-after');
    if (ra) {
      const asNum = parseFloat(ra);
      if (Number.isFinite(asNum)) delay = Math.max(delay, Math.min(30000, Math.ceil(asNum * 1000)));
      else {
        const t = Date.parse(ra);
        if (Number.isFinite(t)) delay = Math.max(delay, Math.min(30000, t - Date.now()));
      }
    }
  } catch { /* ignore */ }
  return Math.max(100, delay);
}

async function fetchWithRetry(url, init, opts = {}) {
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const baseMs = opts.baseDelayMs || DEFAULT_BASE_DELAY_MS;
  const maxMs = opts.maxDelayMs || DEFAULT_MAX_DELAY_MS;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Per-attempt AbortController: aborts the in-flight fetch if it
    // exceeds `timeoutMs`. Without this a hung LLM upstream blocks the
    // request until the reverse proxy 504s.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    controller.signal.addEventListener('abort', () => { timedOut = true; });

    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      // Success or non-retryable failure: return immediately.
      if (!RETRYABLE_STATUS.has(resp.status)) return resp;
      // Last attempt: hand the failed response back to the caller.
      if (attempt === maxAttempts) return resp;
      const delay = computeBackoff(attempt, resp.headers, baseMs, maxMs);
      console.warn(`[httpRetry] ${resp.status} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms | url=${url.split('?')[0]}`);
      await sleep(delay);
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = timedOut || err.name === 'AbortError';
      if (isTimeout) { err.isTimeout = true; err.timeoutMs = timeoutMs; }
      lastErr = err;
      if (attempt === maxAttempts) throw err;
      const delay = computeBackoff(attempt, null, baseMs, maxMs);
      console.warn(`[httpRetry] ${isTimeout ? 'TIMEOUT' : 'NETWORK'} on attempt ${attempt}/${maxAttempts} — retrying in ${delay}ms | url=${url.split('?')[0]}`);
      await sleep(delay);
    }
  }
  // Unreachable; kept for clarity.
  if (lastErr) throw lastErr;
}

module.exports = { fetchWithRetry, RETRYABLE_STATUS };

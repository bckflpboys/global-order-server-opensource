// AI Providers Adapter — Self-hosted version
// Resolves which upstream chat-completions endpoint to call based on the
// AIModel.provider field. All supported providers (OpenRouter, OpenAI,
// DeepSeek) speak the OpenAI chat-completions wire format, so the only
// differences are: base URL, API key env var, and a couple of
// OpenRouter-specific extras (HTTP-Referer / X-Title headers, session_id
// in the body).
//
// Public API:
//   resolveProvider(modelConfigOrLegacy) -> {
//     provider, model, url, apiKey, headers, supportsSessionId
//   }
//
// `modelConfigOrLegacy` may be:
//   - a plain object { provider, apiModelId, openRouterId, modelId }
//   - a plain string (legacy: assumed to be an OpenRouter model id)

const PROVIDERS = {
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    extraHeaders: () => ({
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:3000',
      'X-Title': 'Global Order Self-Hosted'
    }),
    supportsSessionId: true
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    apiKeyEnv: 'OPENAI_API_KEY',
    extraHeaders: () => ({}),
    supportsSessionId: false
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    extraHeaders: () => ({}),
    supportsSessionId: false
  }
};

function resolveProvider(input) {
  let provider = 'openrouter';
  let model = '';

  if (!input) {
    // Pure default: legacy OpenRouter env model
    model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  } else if (typeof input === 'string') {
    // Legacy: bare model id string. Always OpenRouter.
    model = input;
  } else if (typeof input === 'object') {
    provider = (input.provider || 'openrouter').toLowerCase();
    if (!PROVIDERS[provider]) provider = 'openrouter';
    model = input.apiModelId || input.openRouterId || input.modelId || '';
    if (!model) model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  }

  const cfg = PROVIDERS[provider];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    const err = new Error(`${provider} API key not configured (${cfg.apiKeyEnv})`);
    err.code = 'NO_API_KEY';
    err.provider = provider;
    throw err;
  }

  return {
    provider,
    model,
    url: cfg.url,
    apiKey,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...cfg.extraHeaders()
    },
    supportsSessionId: cfg.supportsSessionId
  };
}

// Build a chat-completions body for the given provider, dropping the
// OpenRouter-specific session_id when calling OpenAI/DeepSeek, and
// converting max_tokens to max_completion_tokens for OpenAI.
function buildBody(prov, body) {
  if (!body) return body;

  let result = body;

  // Remove session_id for providers that don't support it
  if (!prov.supportsSessionId && body.session_id !== undefined) {
    const { session_id, ...rest } = body;
    result = rest;
  }

  // OpenAI: convert max_tokens to max_completion_tokens
  if (prov.provider === 'openai' && result.max_tokens !== undefined) {
    const { max_tokens, ...rest } = result;
    result = { ...rest, max_completion_tokens: max_tokens };
  }

  return result;
}

module.exports = {
  resolveProvider,
  buildBody,
  PROVIDERS
};

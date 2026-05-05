// Default OpenRouter models exposed to the extension.
// Edit this file to add/remove models you want to use.
// `id` is what the extension sends back; `openRouterId` is what we send to OpenRouter.
//
// In single-user/self-hosted mode credits are unused, so the cost
// fields are kept only for display compatibility with the extension UI.

module.exports = [
  {
    _id: 'gemini-2-5-flash',
    modelId: 'gemini-2-5-flash',
    name: 'Gemini 2.5 Flash',
    openRouterId: 'google/gemini-2.5-flash',
    tier: 'free',
    description: 'Fast, cheap, great for most tools',
    contextWindow: 1000000,
    creditsPerInputToken: 0,
    creditsPerOutputToken: 0,
    isEnabled: true,
    isDefault: true,
    isVisionModel: true,
    isAgentModel: true,
    sortOrder: 1
  },
  {
    _id: 'claude-3-5-sonnet',
    modelId: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    openRouterId: 'anthropic/claude-3.5-sonnet',
    tier: 'premium',
    description: 'Best quality for complex tools',
    contextWindow: 200000,
    creditsPerInputToken: 0,
    creditsPerOutputToken: 0,
    isEnabled: true,
    isDefault: false,
    isVisionModel: true,
    isAgentModel: true,
    sortOrder: 2
  },
  {
    _id: 'gpt-4o-mini',
    modelId: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    openRouterId: 'openai/gpt-4o-mini',
    tier: 'standard',
    description: 'OpenAI fast & cheap',
    contextWindow: 128000,
    creditsPerInputToken: 0,
    creditsPerOutputToken: 0,
    isEnabled: true,
    isDefault: false,
    isVisionModel: false,
    isAgentModel: false,
    sortOrder: 3
  }
];

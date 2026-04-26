// OpenRouter AI service — generates and iterates Chrome-extension tools.
// No credit accounting; we just proxy the request and return token usage if present.

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are an expert Chrome extension tool generator that writes production-grade, bullet-proof content scripts.

When a user describes what they want, you generate a complete, working Chrome extension tool that injects into web pages and works perfectly the first time.

## OUTPUT FORMAT
You MUST return a valid JSON object with this exact structure (no markdown fences, no explanation outside the JSON):
\`\`\`json
{
  "name": "Tool Name",
  "description": "Brief description of what this tool does",
  "icon": "emoji icon for the tool",
  "targetSites": ["*://example.com/*"],
  "contentScript": "// JavaScript code that runs on the target page",
  "styles": "/* CSS styles injected into the page */",
  "config": {},
  "storageSchema": {},
  "dashboardHTML": "<!-- Complete HTML document for the data management dashboard -->"
}
\`\`\`

## CRITICAL: RUNTIME CONTEXT
This is a Chrome Manifest V3 (MV3) extension. Your \`contentScript\` code will be wrapped in an IIFE by the extension runtime before execution. The code is injected via \`chrome.scripting.executeScript()\` into pages and runs in the ISOLATED content script world.

### MV3 Constraints — your code MUST follow these:
- No background page; use a service worker
- Use \`chrome.action\` (not \`chrome.browserAction\`)
- Use \`chrome.scripting.executeScript()\` (not \`chrome.tabs.executeScript()\`)
- No blocking webRequest handlers
- Code runs in an ISOLATED world; you have full DOM access but no access to the page's JS variables

### Pre-defined Variables (available in your code):
- \`TOOL_ID\` (string), \`TOOL_NAME\` (string)

### Pre-defined Functions:
- \`ToolStorage.get(key)\` / \`set(key, value)\` / \`getAll()\` / \`clear()\`
- \`downloadData(data, filename, mimeType)\`
- \`showToolToast(message)\`

### Do NOT:
- import/require modules; use \`export\`
- redeclare \`ToolStorage\`, \`TOOL_ID\`, \`TOOL_NAME\`, \`showToolToast\`, \`downloadData\`
- use \`chrome.storage\` directly — always use \`ToolStorage\`
- assume the DOM is ready — always wait for elements

## MANDATORY PATTERNS
1. Always wait for elements with a MutationObserver-based \`waitForElement(selector, timeout)\` helper.
2. Use a MutationObserver for dynamic content (SPAs).
3. Try multiple fallback CSS selectors and log which one worked.
4. Wrap initialization in try/catch; log with \`[New Order]\` prefix; surface errors via \`showToolToast\`.
5. Mark every injected DOM element with \`data-no-tool="\${TOOL_ID}"\`.

## UI DESIGN
Floating panel, dark theme (#1a1a28 / #f0f0f5 / accent #7c5cfc), 12px radius, draggable header with minimize/close, z-index 99999, system-ui font. Compact and non-intrusive.

## DATA COLLECTION
If the tool collects data: floating panel with live counter, export/download (CSV for tabular, JSON otherwise), Clear button, auto-save via \`ToolStorage.set\`, restore on init via \`ToolStorage.get\`.

## TARGET SITES
Use Chrome match patterns like \`*://www.example.com/*\`. For all sites use \`["*://*/*"]\`. Be specific when possible.

## DASHBOARD UI (dashboardHTML)
A complete, self-contained HTML document (\`<!DOCTYPE html>\` to \`</html>\`) with inline CSS/JS. Dark theme (background #0a0a0f, cards #12121a, text #f0f0f5, accent #7c5cfc), Inter font.
Communicate with parent via \`window.postMessage\`:
- Receive tool data: listen for \`{type:'toolData', data}\`
- Request data on load: \`window.parent.postMessage({type:'requestData'}, '*')\`
- Send commands: \`exportData\`, \`clearData\`, \`updateData\`, \`deleteData\`
Include header with summary stats, search/filter inputs, Export JSON/CSV/Clear All buttons, and a "No data yet" empty state. Iframe is \`width:100%; min-height:500px\`. Do NOT use \`alert()\` or \`confirm()\`.

## IMPORTANT
- Return ONLY the JSON object (no fences, no extra text).
- contentScript is raw JS executed immediately.
- styles is raw CSS.
- dashboardHTML is a full HTML page.
- Make the tool actually useful — no placeholders.
- Always call \`showToolToast()\` at initialization to confirm the tool is running.`;

function parseToolJson(content) {
  if (!content) throw new Error('Empty AI response');
  try {
    return JSON.parse(content);
  } catch {}
  const fence = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) return JSON.parse(fence[1]);
  const obj = content.match(/\{[\s\S]*\}/);
  if (obj) return JSON.parse(obj[0]);
  throw new Error('Could not parse AI response as JSON');
}

async function callOpenRouter(messages, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3001',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'New Order Self-Hosted'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 12000,
      response_format: { type: 'json_object' }
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('[openrouter] error', response.status, text.slice(0, 500));
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return { tool: parseToolJson(content), usage: data.usage || {}, model: data.model || model };
}

async function generateToolFromPrompt(prompt, ctx = {}) {
  const model = ctx.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

  let contextInfo = '';
  if (ctx.currentSite) contextInfo += `\nUser is currently on: ${ctx.currentSite}`;
  if (ctx.currentUrl) contextInfo += `\nFull URL: ${ctx.currentUrl}`;
  if (ctx.pageTitle) contextInfo += `\nPage title: ${ctx.pageTitle}`;
  const userMessage = contextInfo ? `${prompt}\n\n[Context: ${contextInfo}]` : prompt;

  const result = await callOpenRouter(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ],
    model
  );

  if (!result.tool.name) result.tool.name = 'Custom Tool';
  if (!result.tool.contentScript) throw new Error('AI did not generate any code');
  if (!result.tool.targetSites?.length) result.tool.targetSites = ['*://*/*'];
  result.tool.id = 'tool_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  return result;
}

async function iterateToolFromFeedback(existingTool, feedback, chatHistory = [], opts = {}) {
  const model = opts.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content:
        `Here is the current tool code:\n\n` +
        `Name: ${existingTool.name}\n` +
        `Target Sites: ${(existingTool.targetSites || []).join(', ')}\n\n` +
        `JavaScript:\n${existingTool.contentScript}\n\n` +
        `CSS:\n${existingTool.styles || 'none'}\n\n` +
        `User feedback / changes requested:\n${feedback}\n\n` +
        `Please update the tool based on this feedback. Return the complete updated tool as JSON.`
    }
  ];

  const result = await callOpenRouter(messages, model);
  result.tool.id = existingTool.id;
  result.tool.version = (existingTool.version || 1) + 1;
  return result;
}

module.exports = { generateToolFromPrompt, iterateToolFromFeedback };

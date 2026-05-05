// New Order Global — OpenRouter AI Service
// Handles communication with OpenRouter API for tool generation

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ============================================
// System Prompt — The brain of tool generation
// ============================================
const SYSTEM_PROMPT = `You are **New Order** — an expert Chrome extension tool generator that writes production-grade, bullet-proof content scripts.

## CONVERSATIONAL MODE
Not every user message requires generating a tool. If the user asks a **question**, wants **advice**, asks for **explanation**, or is just chatting — respond conversationally in plain text. Do NOT return JSON unless the user is explicitly requesting you to **build**, **create**, **make**, **generate**, or **modify** a tool.

When returning a plain text answer (no tool generation), just respond naturally. Only return the JSON tool object when the user clearly wants a tool built or modified.

## TOOL GENERATION MODE
When a user describes what they want built, you generate a complete, working Chrome extension tool that injects into web pages and works perfectly the first time.

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
This is a **Chrome Manifest V3 (MV3)** extension. Your \`contentScript\` code will be wrapped in an IIFE (Immediately Invoked Function Expression) by the extension runtime before execution. The code is injected via \`chrome.scripting.executeScript()\` into pages and runs in the **ISOLATED** content script world.

### Manifest V3 Constraints — your code MUST follow these:
- There is NO background page — the extension uses a service worker
- There is NO \`chrome.browserAction\` — MV3 uses \`chrome.action\`
- There is NO \`chrome.tabs.executeScript()\` — MV3 uses \`chrome.scripting.executeScript()\`
- There are NO blocking webRequest handlers in MV3
- \`XMLHttpRequest\` is available but \`fetch()\` is preferred
- Your code runs in an ISOLATED world — you CAN access \`chrome.storage\` and \`chrome.runtime\` APIs, but the runtime wrapper provides \`ToolStorage\` which is simpler and scoped to your tool
- You have full DOM access to the host page
- You do NOT have access to the page's JavaScript variables (isolated world)

### Pre-defined Variables (available in your code):
- \`TOOL_ID\` (string) — unique identifier for this tool instance
- \`TOOL_NAME\` (string) — human-readable name of this tool

### Pre-defined Functions (available in your code):
- \`ToolStorage.get(key)\` → Promise<any|null> — retrieve stored data for this tool
- \`ToolStorage.set(key, value)\` → Promise<void> — persist data for this tool
- \`ToolStorage.getAll()\` → Promise<Object> — get all stored data
- \`ToolStorage.clear()\` → Promise<void> — clear all tool data
- \`downloadData(data, filename, mimeType)\` — trigger a file download
- \`showToolToast(message)\` — show a floating notification toast on the page

### IMPORTANT: Do NOT:
- Import any modules or libraries (no \`import\`, no \`require\`)
- Use \`export\` statements
- Redeclare \`ToolStorage\`, \`TOOL_ID\`, \`TOOL_NAME\`, \`showToolToast\`, or \`downloadData\`
- Use \`chrome.storage\` directly — always use \`ToolStorage\` instead
- Use any Manifest V2-only APIs (\`chrome.browserAction\`, \`chrome.tabs.executeScript\`, etc.)
- Assume the DOM is ready — always wait for elements

## MANDATORY CODING PATTERNS

### 1. Always Wait For Elements (SPAs like Amazon, YouTube, etc.)
Many modern sites load content dynamically. NEVER assume elements exist at script start. ALWAYS use this helper pattern at the top of your contentScript:

\`\`\`javascript
function waitForElement(selector, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);
    const observer = new MutationObserver((mutations, obs) => {
      const found = document.querySelector(selector);
      if (found) { obs.disconnect(); resolve(found); }
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error('Timeout waiting for: ' + selector)); }, timeout);
  });
}
\`\`\`

### 2. Use MutationObserver for Dynamic Content
For pages that reload content without full page loads (SPAs), observe DOM changes:

\`\`\`javascript
const observer = new MutationObserver((mutations) => {
  // Re-scan for data or re-inject UI
});
observer.observe(document.body, { childList: true, subtree: true });
\`\`\`

### 3. Robust CSS Selectors
- Try MULTIPLE fallback selectors for critical elements
- Log which selector worked: \`console.log('[New Order] Found price via:', selector)\`
- Example for Amazon price:
  \`\`\`javascript
  const PRICE_SELECTORS = [
    '.a-price .a-offscreen',
    '#corePrice_feature_div .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '.apexPriceToPay .a-offscreen',
    '#price_inside_buybox',
    '.priceToPay .a-offscreen'
  ];
  let priceEl = null;
  for (const sel of PRICE_SELECTORS) {
    priceEl = document.querySelector(sel);
    if (priceEl) { console.log('[New Order] Price found via:', sel); break; }
  }
  \`\`\`

### 4. Error Handling
- Wrap ALL initialization in try/catch
- Log errors with \`console.error('[New Order]', error)\`
- Show user-facing errors with \`showToolToast('Error: ...')\`
- Never let an error crash the entire tool

### 5. Cleanup
- Mark ALL injected DOM elements with \`data-no-tool\` attribute set to \`TOOL_ID\`
- Example: \`panel.setAttribute('data-no-tool', TOOL_ID);\`

## UI DESIGN GUIDELINES — PREMIUM EDITORIAL THEME
The extension uses a premium editorial design system called "Alexandria". ALL generated tool UIs MUST follow this aesthetic:

### Floating Panel Style:
- Use a floating panel anchored to bottom-right or top-right
- Light premium theme: background #ffffff, surface #ecebec, text #1b1c1d, muted text #737784
- Primary accent: #b8341c (rich editorial red) — use for buttons, highlights, active states
- Secondary text: #434653
- Border: 1px solid rgba(60, 64, 75, 0.2) — subtle ghost borders, NOT heavy outlines
- Border-radius: 12px, subtle box-shadow: 0 8px 28px rgba(27, 28, 29, 0.14)
- Font: system-ui, -apple-system, 'Inter', sans-serif; headings can use Georgia or serif
- Z-index: 99999 to stay on top
- Keep it compact, elegant, and non-intrusive
- Make panels draggable with a header bar
- Include a minimize/close button
- Use smooth transitions (0.2s ease)

### Color Rules:
- NO purple unless the user explicitly asks for purple
- NO heavy gradients — prefer solid colors with subtle opacity variations
- Accent color is #b8341c (red). Use rgba(184, 52, 28, 0.1) for light accent backgrounds
- For success states: #2e7d4f. For warnings: #8a6d00. For errors: #ba1a1a
- Buttons: solid #b8341c background with white text, or outlined with ghost border
- Cards/panels: white (#ffffff) background on #ecebec page background
- Gold accent for premium/special elements: #6d5e00

## DATA COLLECTION TOOLS
When the tool collects data (emails, links, prices, images, text, etc.):
1. Create a floating panel UI to show collected data with a live counter
2. Include export/download button (CSV for tabular data, JSON otherwise)
3. Include a "Clear" button to reset data
4. Auto-save collected data using \`await ToolStorage.set(key, data)\`
5. Load previously collected data on init: \`const saved = await ToolStorage.get(key)\`
6. Update the panel display whenever new data is found

## TARGET SITES FORMAT
- Use Chrome extension match patterns: \`*://example.com/*\`
- For subdomains: \`*://*.example.com/*\`
- For "any website" / "all sites": \`["*://*/*"]\`
- Be specific — prefer \`*://www.amazon.com/*\` over \`*://*/*\`
- Include all relevant subdomains: \`["*://www.amazon.com/*", "*://smile.amazon.com/*", "*://www.amazon.co.uk/*"]\`

## DASHBOARD UI (dashboardHTML field)
You MUST also generate a \`dashboardHTML\` field — a **complete, self-contained HTML document** (with inline CSS and JS) that serves as the data management dashboard for this tool. This dashboard is displayed inside an iframe on the tool's detail page in the extension.

### Purpose of the Dashboard:
- View all data collected/stored by the tool (tables, lists, charts, etc.)
- Search and filter collected data
- Edit or delete individual entries
- Export data (CSV, JSON, or custom formats)
- Import/upload data if relevant
- Show summary stats (total items, date range, etc.)
- Clear all data with confirmation

### Dashboard Communication via postMessage:
The dashboard iframe communicates with the parent page using \`window.postMessage\`. The parent page will:
1. Inject initial data into the iframe HTML AND send it via postMessage after load
2. Listen for commands from the iframe (export, clear, save, etc.)

**IMPORTANT:** The parent injects the initial tool data directly as \`window.__noInitialData\` AND sends it via postMessage. Your dashboard MUST handle both to be robust. Use this EXACT pattern:

#### Receiving data from parent (put this in your dashboard's \`<script>\`):
\`\`\`javascript
let toolData = {};
function handleIncomingData(payload) {
  toolData = payload.data || {};
  renderDashboard(toolData); // Your function to render the UI
}
// Listen for postMessage data updates from parent
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'toolData') {
    handleIncomingData(event.data);
  }
});
// On DOM ready: check for injected initial data, otherwise request it
document.addEventListener('DOMContentLoaded', () => {
  if (window.__noInitialData) {
    handleIncomingData(window.__noInitialData);
    window.__noInitialData = null;
  }
  // Always also request via postMessage as a backup
  try { window.parent.postMessage({ type: 'requestData' }, '*'); } catch(e) {}
});
\`\`\`

#### Sending commands to parent:
\`\`\`javascript
// Export data
window.parent.postMessage({ type: 'exportData', format: 'json' }, '*');
window.parent.postMessage({ type: 'exportData', format: 'csv' }, '*');
// Clear all data
window.parent.postMessage({ type: 'clearData' }, '*');
// Update a specific key
window.parent.postMessage({ type: 'updateData', key: 'someKey', value: newValue }, '*');
// Delete a specific key
window.parent.postMessage({ type: 'deleteData', key: 'someKey' }, '*');
\`\`\`

#### CRITICAL button wiring rules:
- All Export JSON, Export CSV, Clear All Data buttons MUST use the postMessage commands above
- Buttons MUST be wired using addEventListener in your \`<script>\`, NOT inline onclick attributes
- After sending \`clearData\`, call \`renderDashboard({})\` locally to immediately update the UI
- After sending \`deleteData\`, remove the entry from the local \`toolData\` and re-render

### Dashboard Design Rules:
- Must be a COMPLETE HTML document (\`<!DOCTYPE html>\` to \`</html>\`)
- All CSS and JS must be inline (no external imports)
- Use the Alexandria editorial light theme:
  - Page background: #ecebec
  - Card/panel background: #ffffff
  - Text primary: #1b1c1d, secondary: #434653, muted: #737784
  - Accent/primary: #b8341c (red) — buttons, links, highlights
  - Borders: rgba(60, 64, 75, 0.2) ghost borders
  - Shadows: 0 2px 10px rgba(27, 28, 29, 0.10)
  - NO purple, NO heavy gradients
- Use font-family: 'Inter', system-ui, sans-serif (load from Google Fonts CDN is OK)
- Include a header with the tool name and summary stats
- Make tables responsive with horizontal scroll
- Add search/filter inputs for data with many entries
- Include action buttons: Export JSON, Export CSV, Clear All
- Show a "No data yet" empty state with helpful text
- Size: the iframe will be \`width: 100%; min-height: 500px\`
- Do NOT use alert() or confirm() — use inline UI for confirmations

## QUALITY CHECKLIST (mentally verify before responding)
✅ contentScript code is raw JS that executes immediately (no module syntax)
✅ All elements are waited for with waitForElement() or MutationObserver
✅ Multiple fallback selectors tried for important page elements
✅ All injected DOM elements have data-no-tool attribute
✅ Uses ToolStorage (not chrome.storage) for persistence
✅ Does NOT redeclare runtime-provided variables
✅ Error handling around every DOM query and async operation
✅ showToolToast() called on successful initialization
✅ Panel is draggable with minimize/close buttons
✅ console.log('[New Order]') prefix on all debug logs
✅ dashboardHTML is a complete, self-contained HTML document
✅ Dashboard uses postMessage to request and receive tool data
✅ Dashboard includes Export, Search/Filter, and Clear functionality

## IMPORTANT
- Return ONLY the JSON object, no markdown code fences, no explanation
- The contentScript should be raw JavaScript that executes immediately
- The styles should be raw CSS without any wrapper
- The dashboardHTML should be a complete HTML page with inline CSS/JS
- Make the tool actually useful and complete — no placeholders
- If the user's request is unclear, make reasonable assumptions and build the most useful version
- ALWAYS call showToolToast() at initialization to confirm the tool is running`;

// ============================================
// Generate a tool from user prompt
// ============================================
async function generateToolFromPrompt(prompt, context = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const model = context.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  const sessionId = context.sessionId || null;

  // Build context message
  let contextInfo = '';
  if (context.currentSite) {
    contextInfo += `\nUser is currently on: ${context.currentSite}`;
  }
  if (context.currentUrl) {
    contextInfo += `\nFull URL: ${context.currentUrl}`;
  }
  if (context.pageTitle) {
    contextInfo += `\nPage title: ${context.pageTitle}`;
  }

  const userMessage = contextInfo
    ? `${prompt}\n\n[Context: ${contextInfo}]`
    : prompt;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3001',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'New Order Self-Hosted'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.4,
      max_tokens: 12000
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    console.error('OpenRouter API error:', response.status, errorData);
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json();

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from AI');
  }

  const content = data.choices[0].message?.content;
  if (!content) {
    throw new Error('Empty AI response');
  }

  // Detect if this is a conversational (plain text) response or a tool JSON
  let tool;
  let isConversational = false;
  try {
    // Try direct parse first
    tool = JSON.parse(content);
    // Check if it's actually a tool object (has contentScript)
    if (!tool.contentScript) {
      isConversational = true;
      tool = null;
    }
  } catch {
    // Try extracting JSON from markdown code block
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        tool = JSON.parse(jsonMatch[1]);
        if (!tool.contentScript) { isConversational = true; tool = null; }
      } catch { isConversational = true; }
    } else {
      // Try finding JSON object in the response
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          tool = JSON.parse(objMatch[0]);
          if (!tool.contentScript) { isConversational = true; tool = null; }
        } catch { isConversational = true; }
      } else {
        isConversational = true;
      }
    }
  }

  // If conversational, return the plain text response instead of a tool
  if (isConversational || !tool) {
    return {
      conversational: true,
      message: content,
      usage: data.usage || {},
      model: data.model || model
    };
  }

  // Validate required fields
  if (!tool.name) tool.name = 'Custom Tool';
  if (!tool.contentScript) throw new Error('AI did not generate any code');
  if (!tool.targetSites || tool.targetSites.length === 0) {
    tool.targetSites = ['*://*/*'];
  }

  // Generate a unique ID
  tool.id = 'tool_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

  return {
    tool,
    usage: data.usage || {},
    model: data.model || model
  };
}

// ============================================
// Iterate on existing tool
// ============================================
async function iterateToolFromFeedback(existingTool, feedback, chatHistory = [], options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter API key not configured');
  }

  const model = options.model || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
  const sessionId = options.sessionId || null;

  // Build messages from chat history
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...chatHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    {
      role: 'user',
      content: `Here is the current tool code:\n\nName: ${existingTool.name}\nTarget Sites: ${existingTool.targetSites?.join(', ')}\n\nJavaScript:\n${existingTool.contentScript}\n\nCSS:\n${existingTool.styles || 'none'}\n\nUser feedback / changes requested:\n${feedback}\n\nPlease update the tool based on this feedback. Return the complete updated tool as JSON.`
    }
  ];

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3001',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'New Order Self-Hosted'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 12000
    })
  });

  if (!response.ok) {
    throw new Error(`AI service error (${response.status})`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty AI response');
  }

  // Detect conversational vs tool response
  let tool;
  let isConversational = false;
  try {
    tool = JSON.parse(content);
    if (!tool.contentScript) { isConversational = true; tool = null; }
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        tool = JSON.parse(jsonMatch[1]);
        if (!tool.contentScript) { isConversational = true; tool = null; }
      } catch { isConversational = true; }
    } else {
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          tool = JSON.parse(objMatch[0]);
          if (!tool.contentScript) { isConversational = true; tool = null; }
        } catch { isConversational = true; }
      } else {
        isConversational = true;
      }
    }
  }

  if (isConversational || !tool) {
    return {
      conversational: true,
      message: content,
      usage: data.usage || {},
      model: data.model || model
    };
  }

  // Preserve the original tool ID
  tool.id = existingTool.id;
  tool.version = (existingTool.version || 1) + 1;

  return {
    tool,
    usage: data.usage || {},
    model: data.model || model
  };
}

// ============================================
// Streaming chat completion — yields chunks as they arrive
// ============================================
async function* streamChatCompletion(messages, model, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OpenRouter API key not configured');

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'http://localhost:3001',
      'X-Title': process.env.OPENROUTER_APP_TITLE || 'New Order Self-Hosted'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature || 0.4,
      max_tokens: options.maxTokens || 12000,
      stream: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenRouter streaming error:', response.status, errorText);
    throw new Error(`AI service error (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = '';
  let buffer = '';
  let streamUsage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') continue;
      if (!trimmed.startsWith('data: ')) continue;

      try {
        const data = JSON.parse(trimmed.slice(6));
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          yield { type: 'chunk', content: delta, fullContent };
        }
        // Some providers send usage at the end of the stream
        if (data.usage) {
          streamUsage = data.usage;
        }
      } catch (e) {
        // Skip malformed JSON lines
      }
    }
  }

  // Process any remaining buffer
  if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim().startsWith('data: ')) {
    try {
      const data = JSON.parse(buffer.trim().slice(6));
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) {
        fullContent += delta;
        yield { type: 'chunk', content: delta, fullContent };
      }
      if (data.usage) streamUsage = data.usage;
    } catch (e) {}
  }

  yield { type: 'complete', fullContent, usage: streamUsage };
}

// ============================================
// Parse accumulated content into tool or conversational response
// ============================================
function parseToolResponse(content) {
  let tool;
  let isConversational = false;
  try {
    tool = JSON.parse(content);
    if (!tool.contentScript) { isConversational = true; tool = null; }
  } catch {
    const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      try {
        tool = JSON.parse(jsonMatch[1]);
        if (!tool.contentScript) { isConversational = true; tool = null; }
      } catch { isConversational = true; }
    } else {
      const objMatch = content.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          tool = JSON.parse(objMatch[0]);
          if (!tool.contentScript) { isConversational = true; tool = null; }
        } catch { isConversational = true; }
      } else {
        isConversational = true;
      }
    }
  }

  if (isConversational || !tool) {
    return { conversational: true, message: content };
  }

  if (!tool.name) tool.name = 'Custom Tool';
  if (!tool.targetSites || tool.targetSites.length === 0) {
    tool.targetSites = ['*://*/*'];
  }

  return { tool };
}

module.exports = { generateToolFromPrompt, iterateToolFromFeedback, streamChatCompletion, parseToolResponse, SYSTEM_PROMPT };

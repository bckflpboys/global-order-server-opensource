// AI generation + iteration + streaming. Self-hosted: no credit deduction, no daily caps.
// All users get super_agent tier (unlimited).

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { generateToolFromPrompt, iterateToolFromFeedback, streamChatCompletion, parseToolResponse, SYSTEM_PROMPT } = require('../services/openrouter');
const db = require('../storage');

const router = express.Router();

const MAX_PROMPT_LENGTH = 10000;
const MAX_FEEDBACK_LENGTH = 10000;
const MIN_PROMPT_LENGTH = 3;

async function pickModel(modelId) {
  if (modelId) {
    const m = await db.models.findById(modelId);
    if (m) return m;
  }
  return db.models.findDefault();
}

// ============================================
// POST /api/ai/generate — Generate a new tool
// ============================================
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, currentUrl, currentSite, pageTitle, modelId, conversationId } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Please describe what you want to build' });
    }
    if (prompt.trim().length < MIN_PROMPT_LENGTH) {
      return res.status(400).json({ error: 'Please provide a more detailed description' });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return res.status(400).json({ error: 'Prompt is too long' });
    }

    const model = await pickModel(modelId);
    if (!model) return res.status(503).json({ error: 'No AI models configured' });

    const result = await generateToolFromPrompt(prompt, {
      currentUrl: currentUrl || '',
      currentSite: currentSite || '',
      pageTitle: pageTitle || '',
      model: model.openRouterId
    });

    // Find or create the conversation
    let convo = null;
    if (conversationId) {
      convo = await db.conversations.findOne(conversationId, req.userId);
    }
    if (!convo) {
      const title = prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt;
      convo = await db.conversations.create({
        userId: String(req.userId),
        title,
        modelUsed: model.name
      });
    }

    // Handle conversational (non-tool) response
    if (result.conversational) {
      const newMessages = [
        ...(convo.messages || []),
        { role: 'user', content: prompt, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
        { role: 'assistant', content: result.message, creditsUsed: 0, model: model.name, inputTokens: result.usage?.prompt_tokens || 0, outputTokens: result.usage?.completion_tokens || 0, timestamp: new Date().toISOString() }
      ];
      convo = await db.conversations.update(convo._id, {
        messages: newMessages,
        messageCount: newMessages.length,
        modelUsed: model.name
      });

      return res.json({
        conversational: true,
        message: result.message,
        conversationId: convo._id,
        usage: {
          creditsUsed: 0,
          creditsRemaining: 999999,
          model: model.name,
          totalConversationCredits: 0
        }
      });
    }

    // Save tool as draft
    const toolDoc = await db.tools.create({
      userId: String(req.userId),
      name: result.tool.name,
      description: result.tool.description || '',
      icon: result.tool.icon || '🔧',
      targetSites: result.tool.targetSites,
      status: 'draft',
      contentScript: result.tool.contentScript,
      styles: result.tool.styles || '',
      config: result.tool.config || {},
      storageSchema: result.tool.storageSchema || {},
      dashboardHTML: result.tool.dashboardHTML || '',
      originalPrompt: prompt,
      modelUsed: model.modelId,
      version: 1,
      chatHistory: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: JSON.stringify(result.tool) }
      ]
    });

    const inputTokens = result.usage?.prompt_tokens || 0;
    const outputTokens = result.usage?.completion_tokens || 0;

    const aiSummary =
      '✅ Created "' +
      result.tool.name +
      '"\n\n' +
      (result.tool.description || '') +
      '\n\nTarget: ' +
      ((result.tool.targetSites || []).join(', ') || '*');

    const newMessages = [
      ...(convo.messages || []),
      { role: 'user', content: prompt, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
      { role: 'assistant', content: aiSummary, creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
    ];

    convo = await db.conversations.update(convo._id, {
      messages: newMessages,
      messageCount: newMessages.length,
      modelUsed: model.name,
      toolId: toolDoc._id,
      toolName: result.tool.name
    });

    result.tool.id = toolDoc._id;
    result.tool.dbId = toolDoc._id;

    res.json({
      tool: result.tool,
      conversationId: convo._id,
      usage: {
        creditsUsed: 0,
        creditsRemaining: 999999,
        inputTokens,
        outputTokens,
        model: model.name,
        totalConversationCredits: 0
      }
    });
  } catch (e) {
    console.error('[ai/generate]', e);
    res.status(500).json({ error: e.message || 'Failed to generate tool' });
  }
});

// ============================================
// POST /api/ai/iterate — Modify an existing tool
// ============================================
router.post('/iterate', requireAuth, async (req, res) => {
  try {
    const { toolId, feedback, currentCode, modelId, conversationId } = req.body || {};
    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ error: 'Please describe the changes you want' });
    }
    if (feedback.length > MAX_FEEDBACK_LENGTH) {
      return res.status(400).json({ error: 'Feedback is too long' });
    }

    const model = await pickModel(modelId);
    if (!model) return res.status(503).json({ error: 'No AI models configured' });

    let toolDoc = null;
    let existing = currentCode;
    if (toolId) {
      toolDoc = await db.tools.findOne(toolId, req.userId);
      if (toolDoc) {
        existing = {
          id: toolDoc._id,
          name: toolDoc.name,
          contentScript: toolDoc.contentScript,
          styles: toolDoc.styles,
          targetSites: toolDoc.targetSites,
          config: toolDoc.config,
          version: toolDoc.version
        };
      }
    }
    if (!existing) return res.status(404).json({ error: 'Tool not found' });

    const chatHistory = toolDoc?.chatHistory || [];
    const result = await iterateToolFromFeedback(existing, feedback, chatHistory, {
      model: model.openRouterId
    });

    // Handle conversational (non-tool) response
    if (result.conversational) {
      let convo = null;
      if (conversationId) {
        convo = await db.conversations.findOne(conversationId, req.userId);
        if (convo) {
          const inputTokens = result.usage?.prompt_tokens || 0;
          const outputTokens = result.usage?.completion_tokens || 0;
          const messages = [
            ...(convo.messages || []),
            { role: 'user', content: feedback, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
            { role: 'assistant', content: result.message, creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
          ];
          convo = await db.conversations.update(convo._id, {
            messages,
            messageCount: messages.length
          });
        }
      }

      return res.json({
        conversational: true,
        message: result.message,
        conversationId: convo ? convo._id : null,
        usage: {
          creditsUsed: 0,
          creditsRemaining: 999999,
          model: model.name,
          totalConversationCredits: 0
        }
      });
    }

    if (toolDoc) {
      const history = [
        ...(toolDoc.chatHistory || []),
        { role: 'user', content: feedback },
        { role: 'assistant', content: JSON.stringify(result.tool) }
      ];
      await db.tools.update(toolDoc._id, {
        name: result.tool.name,
        description: result.tool.description || '',
        contentScript: result.tool.contentScript,
        styles: result.tool.styles || '',
        config: result.tool.config || {},
        targetSites: result.tool.targetSites,
        dashboardHTML: result.tool.dashboardHTML || toolDoc.dashboardHTML || '',
        version: result.tool.version || (toolDoc.version || 1) + 1,
        chatHistory: history
      });
    }

    let convo = null;
    if (conversationId) {
      convo = await db.conversations.findOne(conversationId, req.userId);
      if (convo) {
        const inputTokens = result.usage?.prompt_tokens || 0;
        const outputTokens = result.usage?.completion_tokens || 0;
        const messages = [
          ...(convo.messages || []),
          { role: 'user', content: feedback, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
          { role: 'assistant', content: '✅ Updated tool based on your feedback.', creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
        ];
        convo = await db.conversations.update(convo._id, {
          messages,
          messageCount: messages.length
        });
      }
    }

    res.json({
      tool: result.tool,
      conversationId: convo ? convo._id : null,
      usage: {
        creditsUsed: 0,
        creditsRemaining: 999999,
        model: model.name,
        totalConversationCredits: 0
      }
    });
  } catch (e) {
    console.error('[ai/iterate]', e);
    res.status(500).json({ error: e.message || 'Failed to iterate tool' });
  }
});

// ============================================
// POST /api/ai/estimate — Estimate credits (always 0 for self-hosted)
// ============================================
router.post('/estimate', requireAuth, async (req, res) => {
  res.json({ estimatedCredits: 0, model: 'local', userCredits: 999999 });
});

// ============================================
// POST /api/ai/generate-stream — Generate a new tool with streaming
// ============================================
router.post('/generate-stream', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { prompt, currentUrl, currentSite, pageTitle, modelId, conversationId } = req.body;

    if (!prompt || !prompt.trim()) {
      sendSSE('error', { error: 'Please describe what you want to build' });
      return res.end();
    }
    if (prompt.trim().length < MIN_PROMPT_LENGTH) {
      sendSSE('error', { error: 'Please provide a more detailed description' });
      return res.end();
    }
    if (prompt.trim().length > MAX_PROMPT_LENGTH) {
      sendSSE('error', { error: `Prompt is too long (max ${MAX_PROMPT_LENGTH} characters)` });
      return res.end();
    }

    const model = await pickModel(modelId);
    if (!model) { sendSSE('error', { error: 'No AI models available' }); return res.end(); }

    // Build messages
    let contextInfo = '';
    if (currentSite) contextInfo += `\nUser is currently on: ${currentSite}`;
    if (currentUrl) contextInfo += `\nFull URL: ${currentUrl}`;
    if (pageTitle) contextInfo += `\nPage title: ${pageTitle}`;
    const userMessage = contextInfo ? `${prompt}\n\n[Context: ${contextInfo}]` : prompt;

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage }
    ];

    sendSSE('start', { model: model.name });

    let fullContent = '';
    let streamUsage = null;

    for await (const event of streamChatCompletion(messages, model.openRouterId)) {
      if (event.type === 'chunk') {
        fullContent = event.fullContent;
        sendSSE('chunk', { content: event.content });
      } else if (event.type === 'complete') {
        fullContent = event.fullContent;
        streamUsage = event.usage;
      }
    }

    const parsed = parseToolResponse(fullContent);

    // Get or create conversation
    let convo;
    if (conversationId) {
      convo = await db.conversations.findOne(conversationId, req.userId);
    }
    if (!convo) {
      const title = prompt.length > 60 ? prompt.substring(0, 57) + '...' : prompt;
      convo = await db.conversations.create({
        userId: String(req.userId),
        title,
        modelUsed: model.name
      });
    }

    const inputTokens = streamUsage?.prompt_tokens || 0;
    const outputTokens = streamUsage?.completion_tokens || 0;

    // Handle conversational response
    if (parsed.conversational) {
      const newMessages = [
        ...(convo.messages || []),
        { role: 'user', content: prompt, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
        { role: 'assistant', content: parsed.message, creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
      ];
      convo = await db.conversations.update(convo._id, {
        messages: newMessages,
        messageCount: newMessages.length,
        modelUsed: model.name
      });

      sendSSE('done', {
        conversational: true,
        message: parsed.message,
        conversationId: convo._id,
        usage: { creditsUsed: 0, creditsRemaining: 999999, model: model.name, totalConversationCredits: 0 }
      });
      return res.end();
    }

    // Save tool as draft
    const tool = parsed.tool;
    tool.id = 'tool_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

    const toolDoc = await db.tools.create({
      userId: String(req.userId),
      name: tool.name,
      description: tool.description || '',
      icon: tool.icon || '🔧',
      targetSites: tool.targetSites,
      status: 'draft',
      contentScript: tool.contentScript,
      styles: tool.styles || '',
      config: tool.config || {},
      storageSchema: tool.storageSchema || {},
      dashboardHTML: tool.dashboardHTML || '',
      originalPrompt: prompt,
      modelUsed: model.modelId,
      version: 1,
      chatHistory: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: JSON.stringify(tool) }
      ]
    });

    const aiSummary = '✅ Created "' + tool.name + '"\n\n' + (tool.description || '') + '\n\nTarget: ' + (tool.targetSites?.join(', ') || '*');
    const newMessages = [
      ...(convo.messages || []),
      { role: 'user', content: prompt, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
      { role: 'assistant', content: aiSummary, creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
    ];
    convo = await db.conversations.update(convo._id, {
      messages: newMessages,
      messageCount: newMessages.length,
      modelUsed: model.name,
      toolId: toolDoc._id,
      toolName: tool.name
    });

    tool.id = toolDoc._id;
    tool.dbId = toolDoc._id;

    sendSSE('done', {
      tool,
      conversationId: convo._id,
      usage: { creditsUsed: 0, creditsRemaining: 999999, inputTokens, outputTokens, model: model.name, totalConversationCredits: 0 }
    });
    res.end();

  } catch (err) {
    console.error('[AI Generate Stream Error]', err.message);
    sendSSE('error', { error: 'Failed to generate tool. Please try again.' });
    res.end();
  }
});

// ============================================
// POST /api/ai/iterate-stream — Iterate on a tool with streaming
// ============================================
router.post('/iterate-stream', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const sendSSE = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { toolId, feedback, currentCode, modelId, conversationId } = req.body;

    if (!feedback || !feedback.trim()) {
      sendSSE('error', { error: 'Please describe what changes you want' });
      return res.end();
    }
    if (feedback.length > MAX_FEEDBACK_LENGTH) {
      sendSSE('error', { error: `Feedback is too long (max ${MAX_FEEDBACK_LENGTH} characters)` });
      return res.end();
    }

    const model = await pickModel(modelId);
    if (!model) { sendSSE('error', { error: 'No AI models available' }); return res.end(); }

    // Find existing tool
    let existingTool = currentCode;
    let toolDoc = null;
    if (toolId) {
      toolDoc = await db.tools.findOne(toolId, req.userId);
      if (toolDoc) {
        existingTool = {
          id: toolDoc._id,
          name: toolDoc.name,
          contentScript: toolDoc.contentScript,
          styles: toolDoc.styles,
          targetSites: toolDoc.targetSites,
          config: toolDoc.config,
          version: toolDoc.version
        };
      }
    }
    if (!existingTool) {
      sendSSE('error', { error: 'Tool not found' });
      return res.end();
    }

    // Build messages
    const chatHistory = toolDoc?.chatHistory || [];
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...chatHistory.map(msg => ({ role: msg.role, content: msg.content })),
      {
        role: 'user',
        content: `Here is the current tool code:\n\nName: ${existingTool.name}\nTarget Sites: ${existingTool.targetSites?.join(', ')}\n\nJavaScript:\n${existingTool.contentScript}\n\nCSS:\n${existingTool.styles || 'none'}\n\nUser feedback / changes requested:\n${feedback}\n\nPlease update the tool based on this feedback. Return the complete updated tool as JSON.`
      }
    ];

    sendSSE('start', { model: model.name });

    let fullContent = '';
    let streamUsage = null;

    for await (const event of streamChatCompletion(messages, model.openRouterId)) {
      if (event.type === 'chunk') {
        fullContent = event.fullContent;
        sendSSE('chunk', { content: event.content });
      } else if (event.type === 'complete') {
        fullContent = event.fullContent;
        streamUsage = event.usage;
      }
    }

    const parsed = parseToolResponse(fullContent);
    const inputTokens = streamUsage?.prompt_tokens || 0;
    const outputTokens = streamUsage?.completion_tokens || 0;

    // Handle conversational response
    if (parsed.conversational) {
      let convo = null;
      if (conversationId) {
        convo = await db.conversations.findOne(conversationId, req.userId);
        if (convo) {
          const newMsgs = [
            ...(convo.messages || []),
            { role: 'user', content: feedback, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
            { role: 'assistant', content: parsed.message, creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
          ];
          convo = await db.conversations.update(convo._id, {
            messages: newMsgs,
            messageCount: newMsgs.length
          });
        }
      }

      sendSSE('done', {
        conversational: true,
        message: parsed.message,
        conversationId: convo ? convo._id : null,
        usage: { creditsUsed: 0, creditsRemaining: 999999, model: model.name, totalConversationCredits: 0 }
      });
      return res.end();
    }

    // Update tool in database
    const tool = parsed.tool;
    tool.id = existingTool.id;
    tool.version = (existingTool.version || 1) + 1;

    if (toolDoc) {
      const history = [
        ...(toolDoc.chatHistory || []),
        { role: 'user', content: feedback },
        { role: 'assistant', content: JSON.stringify(tool) }
      ];
      await db.tools.update(toolDoc._id, {
        name: tool.name,
        description: tool.description || '',
        contentScript: tool.contentScript,
        styles: tool.styles || '',
        config: tool.config || {},
        targetSites: tool.targetSites,
        dashboardHTML: tool.dashboardHTML || toolDoc.dashboardHTML || '',
        version: tool.version,
        chatHistory: history
      });
    }

    // Conversation tracking
    let convo = null;
    if (conversationId) {
      convo = await db.conversations.findOne(conversationId, req.userId);
      if (convo) {
        const newMsgs = [
          ...(convo.messages || []),
          { role: 'user', content: feedback, creditsUsed: 0, model: '', inputTokens: 0, outputTokens: 0, timestamp: new Date().toISOString() },
          { role: 'assistant', content: '✅ Updated tool based on your feedback.', creditsUsed: 0, model: model.name, inputTokens, outputTokens, timestamp: new Date().toISOString() }
        ];
        convo = await db.conversations.update(convo._id, {
          messages: newMsgs,
          messageCount: newMsgs.length
        });
      }
    }

    sendSSE('done', {
      tool,
      conversationId: convo ? convo._id : null,
      usage: { creditsUsed: 0, creditsRemaining: 999999, model: model.name, totalConversationCredits: 0 }
    });
    res.end();

  } catch (err) {
    console.error('[AI Iterate Stream Error]', err.message);
    sendSSE('error', { error: 'Failed to iterate tool. Please try again.' });
    res.end();
  }
});

module.exports = router;

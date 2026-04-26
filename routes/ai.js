// AI generation + iteration. Self-hosted: no credit deduction, no daily caps.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { generateToolFromPrompt, iterateToolFromFeedback } = require('../services/openrouter');
const db = require('../storage');

const router = express.Router();

const MAX_PROMPT_LENGTH = 10000;

async function pickModel(modelId) {
  if (modelId) {
    const m = await db.models.findById(modelId);
    if (m) return m;
  }
  return db.models.findDefault();
}

router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, currentUrl, currentSite, pageTitle, modelId, conversationId } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Please describe what you want to build' });
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

router.post('/iterate', requireAuth, async (req, res) => {
  try {
    const { toolId, feedback, currentCode, modelId, conversationId } = req.body || {};
    if (!feedback || !feedback.trim()) {
      return res.status(400).json({ error: 'Please describe the changes you want' });
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

router.post('/estimate', requireAuth, async (req, res) => {
  // Self-hosted: nothing to bill, so estimate is always 0.
  res.json({ estimatedCredits: 0, model: 'local', userCredits: 999999 });
});

module.exports = router;

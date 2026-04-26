// Tool CRUD. Tools are private to their owning user.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const status = ['draft', 'active', 'archived'].includes(req.query.status)
      ? req.query.status
      : null;
    const tools = await db.tools.findByUser(String(req.userId), status);
    // Strip chatHistory from list responses to keep payload small.
    const list = tools.map((t) => {
      const { chatHistory, ...rest } = t;
      return rest;
    });
    res.json({ tools: list });
  } catch (e) {
    console.error('[tools/list]', e);
    res.status(500).json({ error: 'Failed to list tools' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  const tool = await db.tools.findOne(req.params.id, String(req.userId));
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  res.json({ tool });
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      id,
      name,
      description,
      icon,
      targetSites,
      contentScript,
      styles,
      config,
      storageSchema,
      dashboardHTML,
      originalPrompt
    } = req.body || {};

    // Promote an existing draft → active
    if (id) {
      const existing = await db.tools.findOne(id, String(req.userId));
      if (existing) {
        const updated = await db.tools.update(existing._id, {
          status: 'active',
          name: name || existing.name,
          description: description ?? existing.description,
          ...(contentScript !== undefined ? { contentScript } : {}),
          ...(styles !== undefined ? { styles } : {}),
          ...(config !== undefined ? { config } : {}),
          ...(dashboardHTML !== undefined ? { dashboardHTML } : {})
        });
        return res.json({ tool: updated, message: 'Tool saved and activated' });
      }
    }

    const tool = await db.tools.create({
      userId: String(req.userId),
      name: name || 'Untitled Tool',
      description: description || '',
      icon: icon || '🔧',
      targetSites: Array.isArray(targetSites) && targetSites.length ? targetSites : ['*://*/*'],
      status: 'active',
      contentScript: contentScript || '',
      styles: styles || '',
      config: config || {},
      storageSchema: storageSchema || {},
      dashboardHTML: dashboardHTML || '',
      originalPrompt: originalPrompt || '',
      version: 1
    });

    res.status(201).json({ tool, message: 'Tool created and activated' });
  } catch (e) {
    console.error('[tools/create]', e);
    res.status(500).json({ error: 'Failed to save tool' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  try {
    const tool = await db.tools.findOne(req.params.id, String(req.userId));
    if (!tool) return res.status(404).json({ error: 'Tool not found' });

    const allowed = ['name', 'description', 'icon', 'targetSites', 'status', 'contentScript', 'styles', 'config', 'dashboardHTML'];
    const patch = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) patch[f] = req.body[f];
    }
    if (patch.status && !['draft', 'active', 'archived'].includes(patch.status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updated = await db.tools.update(tool._id, patch);
    res.json({ tool: updated, message: 'Tool updated' });
  } catch (e) {
    console.error('[tools/update]', e);
    res.status(500).json({ error: 'Failed to update tool' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  const tool = await db.tools.findOne(req.params.id, String(req.userId));
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  await db.tools.delete(tool._id);
  res.json({ message: 'Tool deleted' });
});

module.exports = router;

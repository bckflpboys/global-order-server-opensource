// Conversations CRUD (history of generate/iterate sessions).

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const rows = await db.conversations.findByUser(String(req.userId));
  res.json({
    conversations: rows.map((c) => ({
      id: c._id,
      _id: c._id,
      title: c.title,
      totalCreditsUsed: c.totalCreditsUsed || 0,
      messageCount: c.messageCount || (c.messages?.length || 0),
      modelUsed: c.modelUsed || '',
      toolName: c.toolName || '',
      toolId: c.toolId || null,
      status: c.status || 'active',
      createdAt: c.createdAt,
      updatedAt: c.updatedAt
    }))
  });
});

router.post('/', requireAuth, async (req, res) => {
  const { title, modelUsed } = req.body || {};
  const c = await db.conversations.create({
    userId: String(req.userId),
    title: title || 'New Conversation',
    modelUsed: modelUsed || ''
  });
  res.json({
    conversation: {
      id: c._id,
      _id: c._id,
      title: c.title,
      totalCreditsUsed: 0,
      messageCount: 0,
      messages: []
    }
  });
});

router.get('/:id', requireAuth, async (req, res) => {
  const c = await db.conversations.findOne(req.params.id, String(req.userId));
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  res.json({ conversation: c });
});

router.delete('/:id', requireAuth, async (req, res) => {
  const c = await db.conversations.findOne(req.params.id, String(req.userId));
  if (!c) return res.status(404).json({ error: 'Conversation not found' });
  await db.conversations.delete(c._id);
  res.json({ message: 'Conversation deleted' });
});

module.exports = router;

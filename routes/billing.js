// Billing — kept only for extension UI compatibility.
// Self-hosted users have unlimited credits; checkout is disabled.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

router.get('/credits', requireAuth, async (req, res) => {
  const toolCount = await db.tools.countByUser(String(req.userId));
  res.json({
    credits: 999999,
    totalPurchased: 0,
    totalUsed: 0,
    aiRequestsUsed: 0,
    toolsCreated: toolCount,
    packages: []
  });
});

router.post('/checkout', requireAuth, async (req, res) => {
  res.status(501).json({
    error: 'This is a self-hosted server — credits are unlimited and there is no checkout.'
  });
});

module.exports = router;

// Billing — kept only for extension UI compatibility.
// Self-hosted users have unlimited credits and super_agent tier; checkout is disabled.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

// Subscription plans — exposed for extension UI compatibility (no actual payment)
const SUBSCRIPTION_PLANS = {
  monthly:     { label: 'Monthly',     credits: 50,   price: 0, interval: 'month',  agentTier: 'pro',         badge: null },
  yearly:      { label: 'Yearly',      credits: 200,  price: 0, interval: 'year',   agentTier: 'pro',         badge: 'Popular' },
  super_agent: { label: 'Super Agent', credits: 9999, price: 0, interval: 'year',   agentTier: 'super_agent', badge: 'Self-Hosted' }
};

router.get('/credits', requireAuth, async (req, res) => {
  const toolCount = await db.tools.countByUser(String(req.userId));
  res.json({
    credits: 999999,
    totalPurchased: 0,
    totalUsed: 0,
    aiRequestsUsed: 0,
    toolsCreated: toolCount,
    subscription: {
      plan: 'super_agent',
      status: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false
    },
    packages: [],
    subscriptions: Object.entries(SUBSCRIPTION_PLANS).map(([id, plan]) => ({
      id,
      label: plan.label,
      credits: plan.credits,
      price: plan.price,
      interval: plan.interval,
      agentTier: plan.agentTier,
      badge: plan.badge || null
    }))
  });
});

router.get('/purchases', requireAuth, async (req, res) => {
  res.json({ purchases: [] });
});

router.post('/checkout', requireAuth, async (req, res) => {
  res.status(501).json({
    error: 'This is a self-hosted server — credits are unlimited and there is no checkout.'
  });
});

router.post('/subscribe', requireAuth, async (req, res) => {
  res.status(501).json({
    error: 'This is a self-hosted server — you already have the Super Agent tier.'
  });
});

router.post('/cancel-subscription', requireAuth, async (req, res) => {
  res.status(501).json({
    error: 'This is a self-hosted server — there is no subscription to cancel.'
  });
});

module.exports = router;

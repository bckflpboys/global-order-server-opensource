// Auth: register, login, profile, change-password, model-preferences.
// No rate limit, no email enumeration protection — this server is meant
// to be self-hosted by a single user (or a small trusted group).

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../storage');
const { generateToken, requireAuth, publicUser } = require('../middleware/auth');
const { getUserAgentTier, getEffectiveAgentTier } = require('../services/agentTiers');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOW_REGISTER = (process.env.ALLOW_REGISTER || 'true').toLowerCase() !== 'false';

router.post('/register', async (req, res) => {
  try {
    if (!ALLOW_REGISTER) {
      return res.status(403).json({ error: 'Registration is disabled on this server' });
    }
    const { email, password, displayName, tosAccepted, privacyAccepted } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.users.findByEmail(email);
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.users.create({
      email,
      passwordHash,
      displayName: displayName || email.split('@')[0]
    });

    // Create onboarding record
    try {
      await db.onboarding.getOrCreate(String(user._id));
    } catch { /* best effort */ }

    const token = generateToken(user._id);
    res.status(201).json({ token, user: publicUser(user), onboardingCompleted: false });
  } catch (e) {
    console.error('[auth/register]', e);
    res.status(500).json({ error: 'Failed to create account' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.users.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    await db.users.update(user._id, { lastLogin: new Date().toISOString() });
    const token = generateToken(user._id);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error('[auth/login]', e);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const { tierKey, isSubscriber } = getUserAgentTier(req.user);
    const { tier } = await getEffectiveAgentTier(req.user);
    res.json({
      user: {
        ...publicUser(req.user),
        agentTier: {
          key: tierKey,
          name: tier.name,
          maxSteps: tier.maxSteps,
          maxTrackedTabs: tier.maxTrackedTabs,
          maxConcurrentTasks: tier.maxConcurrentTasks,
          maxDailyTasks: tier.maxDailyTasks,
          useCouncilPrompt: tier.useCouncilPrompt,
          canPersistSession: !!tier.canPersistSession,
          sessionPersistenceEnabled: !!tier.sessionPersistenceEnabled
        },
        isSubscriber
      }
    });
  } catch (e) {
    res.json({ user: publicUser(req.user) });
  }
});

router.put('/profile', requireAuth, async (req, res) => {
  const { displayName } = req.body || {};
  const patch = {};
  if (typeof displayName === 'string') patch.displayName = displayName.slice(0, 100);
  const updated = await db.users.update(req.userId, patch);
  res.json({ user: publicUser(updated) });
});

router.put('/model-preferences', requireAuth, async (req, res) => {
  try {
    const { builderModel, agentModel } = req.body || {};
    const patch = {};
    if (builderModel !== undefined && builderModel !== null) {
      if (typeof builderModel !== 'string') return res.status(400).json({ error: 'builderModel must be a string' });
      patch.builderModel = builderModel;
    }
    if (agentModel !== undefined && agentModel !== null) {
      if (typeof agentModel !== 'string') return res.status(400).json({ error: 'agentModel must be a string' });
      patch.agentModel = agentModel;
    }
    const updated = await db.users.update(req.userId, patch);
    res.json({ user: publicUser(updated) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update model preferences' });
  }
});

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const fresh = await db.users.findById(req.userId);
    const ok = await bcrypt.compare(currentPassword, fresh.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.users.update(req.userId, { passwordHash });
    res.json({ message: 'Password updated' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;

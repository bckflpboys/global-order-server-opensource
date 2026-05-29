// User Routes — Self-hosted version
// No security middleware, no audit logging, uses storage abstraction.

const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// ============================================
// PATCH /api/user/profile — Update display name
// ============================================
router.patch('/profile', requireAuth, async (req, res) => {
  try {
    const { displayName } = req.body;

    const patch = {};
    if (displayName !== undefined && displayName !== null) {
      patch.displayName = String(displayName).slice(0, 100);
    }

    const user = await db.users.update(String(req.userId), patch);

    res.json({
      user: {
        id: user._id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        plan: user.plan || 'unlimited',
        subscription: {
          plan: user.subscription?.plan || 'super_agent',
          status: user.subscription?.status || 'active'
        },
        credits: user.credits ?? 999999,
        onboardingCompleted: !!user.onboardingCompleted,
        builderModel: user.builderModel || null,
        agentModel: user.agentModel || null
      }
    });
  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// ============================================
// PATCH /api/user/password — Change password
// ============================================
router.patch('/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new passwords are required' });
    }

    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    if (newPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: 'Password is too long' });
    }

    const user = await db.users.findById(String(req.userId));
    if (!user) return res.status(404).json({ error: 'Account not found' });

    const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await db.users.update(String(req.userId), { passwordHash });

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Password change error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============================================
// GET /api/user/model-preferences — Get builder/agent model prefs
// ============================================
router.get('/model-preferences', requireAuth, async (req, res) => {
  try {
    const user = await db.users.findById(String(req.userId));
    if (!user) return res.status(404).json({ error: 'Account not found' });
    res.json({
      builderModel: user.builderModel || null,
      agentModel: user.agentModel || null
    });
  } catch (err) {
    console.error('Model preferences error:', err.message);
    res.status(500).json({ error: 'Failed to get model preferences' });
  }
});

// ============================================
// PUT /api/user/model-preferences — Set builder/agent model prefs
// ============================================
router.put('/model-preferences', requireAuth, async (req, res) => {
  try {
    const { builderModel, agentModel } = req.body;
    const patch = {};
    if (builderModel !== undefined) patch.builderModel = String(builderModel);
    if (agentModel !== undefined) patch.agentModel = String(agentModel);
    const user = await db.users.update(String(req.userId), patch);
    res.json({
      builderModel: user.builderModel || null,
      agentModel: user.agentModel || null
    });
  } catch (err) {
    console.error('Model preferences update error:', err.message);
    res.status(500).json({ error: 'Failed to update model preferences' });
  }
});

// ============================================
// DELETE /api/user/account — Delete account
// ============================================
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = String(req.userId);
    await db.users.delete(userId);
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    console.error('Account deletion error:', err.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

module.exports = router;

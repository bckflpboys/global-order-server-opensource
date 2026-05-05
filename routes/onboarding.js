// Onboarding Routes — Self-hosted version
// No security middleware, uses storage abstraction.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

// ============================================
// GET /api/onboarding
// ============================================
router.get('/', requireAuth, async (req, res) => {
  try {
    const onboarding = await db.onboarding.getOrCreate(String(req.userId));
    res.json({
      onboarding: {
        userId: onboarding.userId,
        tosAccepted: onboarding.tosAccepted,
        privacyAccepted: onboarding.privacyAccepted,
        whereDidYouHearAboutUs: onboarding.whereDidYouHearAboutUs,
        whereDidYouHearAboutUsOther: onboarding.whereDidYouHearAboutUsOther,
        intendedFeatures: onboarding.intendedFeatures,
        intendedFeaturesOther: onboarding.intendedFeaturesOther,
        completed: onboarding.completed,
        currentStep: onboarding.currentStep
      }
    });
  } catch (err) {
    console.error('Get onboarding error:', err.message);
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

// ============================================
// PUT /api/onboarding
// ============================================
router.put('/', requireAuth, async (req, res) => {
  try {
    const { whereDidYouHearAboutUs, whereDidYouHearAboutUsOther, intendedFeatures, intendedFeaturesOther, currentStep } = req.body;

    let onboarding = await db.onboarding.getOrCreate(String(req.userId));

    const patch = {};
    if (whereDidYouHearAboutUs !== undefined) patch.whereDidYouHearAboutUs = whereDidYouHearAboutUs;
    if (whereDidYouHearAboutUsOther !== undefined) patch.whereDidYouHearAboutUsOther = String(whereDidYouHearAboutUsOther).slice(0, 200);
    if (intendedFeatures !== undefined) patch.intendedFeatures = Array.isArray(intendedFeatures) ? intendedFeatures : [intendedFeatures];
    if (intendedFeaturesOther !== undefined) patch.intendedFeaturesOther = String(intendedFeaturesOther).slice(0, 200);
    if (currentStep !== undefined) patch.currentStep = currentStep;

    onboarding = await db.onboarding.update(onboarding._id, patch);

    res.json({
      onboarding: {
        userId: onboarding.userId,
        tosAccepted: onboarding.tosAccepted,
        privacyAccepted: onboarding.privacyAccepted,
        whereDidYouHearAboutUs: onboarding.whereDidYouHearAboutUs,
        whereDidYouHearAboutUsOther: onboarding.whereDidYouHearAboutUsOther,
        intendedFeatures: onboarding.intendedFeatures,
        intendedFeaturesOther: onboarding.intendedFeaturesOther,
        completed: onboarding.completed,
        currentStep: onboarding.currentStep
      }
    });
  } catch (err) {
    console.error('Update onboarding error:', err.message);
    res.status(500).json({ error: 'Failed to update onboarding' });
  }
});

// ============================================
// POST /api/onboarding/complete
// ============================================
router.post('/complete', requireAuth, async (req, res) => {
  try {
    let onboarding = await db.onboarding.findByUser(String(req.userId));
    if (!onboarding) return res.status(404).json({ error: 'Onboarding record not found' });

    onboarding = await db.onboarding.update(onboarding._id, {
      completed: true,
      completedAt: new Date().toISOString(),
      currentStep: 999
    });

    // Update user record
    await db.users.update(String(req.userId), { onboardingCompleted: true, onboardingCompletedAt: new Date().toISOString() });

    res.json({ message: 'Onboarding completed successfully', onboardingCompleted: true });
  } catch (err) {
    console.error('Complete onboarding error:', err.message);
    res.status(500).json({ error: 'Failed to complete onboarding' });
  }
});

module.exports = router;

// Lists the AI models the extension can choose from.
// Edit storage/default-models.js to add/remove models.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const models = await db.models.findEnabled();
  res.json({
    models: models.map((m) => ({
      id: m.modelId,
      name: m.name,
      tier: m.tier || 'standard',
      description: m.description || '',
      contextWindow: m.contextWindow || 128000,
      creditsPerInputToken: 0,
      creditsPerOutputToken: 0,
      isDefault: !!m.isDefault,
      estimatedToolCost: 0
    }))
  });
});

module.exports = router;

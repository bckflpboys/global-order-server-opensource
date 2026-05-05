// Lists the AI models the extension can choose from.
// Models are loaded from OPENROUTER_MODEL_* env vars (see .env.example).
// Query param: ?agent=true filters for agent-capable models only.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const db = require('../storage');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const { agent } = req.query;
  let models = await db.models.findEnabled();

  // Filter for agent-capable models if requested
  if (agent === 'true') {
    models = models.filter(m => m.isAgentModel);
  }

  res.json({
    models: models.map((m) => ({
      id: m.modelId,
      modelId: m.modelId,
      name: m.name,
      tier: m.tier || 'standard',
      description: m.description || '',
      contextWindow: m.contextWindow || 128000,
      creditsPerInputToken: 0,
      creditsPerOutputToken: 0,
      isDefault: !!m.isDefault,
      isAgentModel: !!m.isAgentModel,
      isVisionModel: !!m.isVisionModel,
      estimatedToolCost: 0
    }))
  });
});

module.exports = router;

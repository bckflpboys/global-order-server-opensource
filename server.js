// Self-hosted New Order Global API server.
// Open-source companion to the New Order Global Chrome extension.
//
// What this server does:
//   - Authenticates a user (JWT) and stores their tools/conversations
//   - Proxies AI generation requests to OpenRouter using YOUR API key
//
// What it explicitly does NOT do:
//   - No payment processing, no credits, no rate limiting
//   - No telemetry, no audit logs, no admin routes
//   - No reaching out to any third-party site beyond OpenRouter

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const db = require('./storage');

const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const toolsRoutes = require('./routes/tools');
const billingRoutes = require('./routes/billing');
const modelsRoutes = require('./routes/models');
const conversationsRoutes = require('./routes/conversations');
const agentRoutes = require('./routes/agent');
const agentSettingsRoutes = require('./routes/agentSettings');
const integrationsRoutes = require('./routes/integrations');
const onboardingRoutes = require('./routes/onboarding');
const userRoutes = require('./routes/user');

const app = express();
const PORT = process.env.PORT || 3001;

// ---------- middleware ----------
// Permissive CORS so the extension (chrome-extension://...) can reach the API.
// You can lock this down via ALLOWED_ORIGINS=comma,separated,list if you want.
const allowed = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, server-to-server
      if (allowed.length === 0) return cb(null, true); // permissive default
      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    }
  })
);

app.use(express.json({ limit: '10mb' }));

// Tiny request logger (no IPs, no headers).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// ---------- routes ----------
app.get('/', (req, res) => {
  res.json({ service: 'New Order Global (self-hosted)', status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', storage: db.backend, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/tools', toolsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/models', modelsRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/agent-settings', agentSettingsRoutes);
app.use('/api/integrations', integrationsRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/user', userRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  res.status(500).json({ error: err.message || 'Internal error' });
});

// ---------- bootstrap ----------
async function start() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  OPENROUTER_API_KEY is not set — AI generation will fail until you set it.');
  }
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET is not set — using a default. Set one in .env for real deployments.');
  }
  await db.connect();

  // Log loaded models
  const { loadFromEnv } = require('./storage/env-models');
  const envModels = loadFromEnv();
  if (envModels) {
    console.log(`   Models:   ${envModels.length} from OPENROUTER_MODEL_* env vars`);
  } else {
    console.log(`   Models:   using defaults (set OPENROUTER_MODEL_* env vars to customise)`);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 Self-hosted API on http://localhost:${PORT}`);
    console.log(`   Storage:  ${db.backend}`);
    console.log(`   Health:   http://localhost:${PORT}/api/health\n`);
  });
}

start().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});

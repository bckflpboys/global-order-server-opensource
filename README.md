# New Order Global — Self-Hosted Server

This is the **open-source backend** that pairs with the
[New Order Global](https://github.com/bckflpboys/new-order-global) Chrome extension. It provides everything the extension needs — auth, AI tool generation, agent execution, memory, integrations, and more.

It does **not**:

- charge anyone or talk to any payment provider
- rate-limit you
- send telemetry anywhere
- require any third-party service except [OpenRouter](https://openrouter.ai)
- require MongoDB (it can run with plain JSON files)

All users get the **Super Agent** tier with maximum limits and unlimited credits.

---

## Architecture

```
global order server opensource/
├── server.js              # Express entry point — permissive CORS, routes, schedule runner
├── package.json            # Node.js dependencies (mongoose + S3 SDK optional)
│
├── models/                 # MongoDB schemas (Mongoose) — identical to upstream
│   ├── User.js             # Users — auth, credits (999999), plan (unlimited)
│   ├── Tool.js             # AI-generated tools — code, styles, dashboardHTML
│   ├── AIModel.js          # Available AI models — pricing (0), tiers, enabled state
│   ├── Conversation.js     # Chat sessions — messages, credit tracking (0)
│   ├── AgentTask.js        # Agent tasks — steps, tracked tabs, research notes,
│   │                        #   goal ledger, captured files, screenshots, page-state diff cache
│   ├── AgentSettings.js    # Per-user agent settings — limits, screenshot policy, custom rules,
│   │                        #   temperature, memory toggles, council roles, sub-agents
│   ├── Integration.js      # Telegram & WhatsApp linking, preferences, inbox queue
│   ├── DomainRule.js       # Per-domain rules — severity (must/should/info), hostname matching
│   ├── UserMemory.js       # Long-term user facts — category, domain scope, confidence
│   ├── ScheduledTask.js    # Cron-scheduled recurring tasks — 5-field cron, briefing, permissions
│   ├── WhatsAppOutbox.js   # Queued outbound WhatsApp messages (in-memory for self-hosted)
│   └── Onboarding.js      # Onboarding progress tracking
│
├── storage/                # Storage abstraction — file or MongoDB
│   ├── index.js            # Picks backend based on STORAGE env var
│   ├── file.js             # JSON file backend (default, no DB needed)
│   ├── mongo.js            # MongoDB backend (optional, for cloud deploys)
│   └── default-models.js   # Static AI model list (edit to add/remove models)
│
├── routes/                 # Express route handlers
│   ├── auth.js             # Register, login, profile, change password
│   ├── ai.js               # Tool generation & iteration via OpenRouter (conversational + JSON, streaming)
│   ├── agent.js            # Global Executive — plan, brief, start, step, answer, stop, screenshot, capture
│   ├── agentSettings.js    # Agent settings CRUD, memory CRUD, domain rules CRUD, scheduled tasks CRUD
│   ├── integrations.js     # Telegram webhook, WhatsApp incoming/outbox, setup, preferences
│   ├── tools.js            # CRUD for user tools (includes dashboardHTML)
│   ├── billing.js          # Stub — always returns 999999 credits, checkout disabled
│   ├── models.js           # List enabled AI models
│   ├── conversations.js    # Conversation CRUD
│   ├── onboarding.js       # Onboarding flow
│   └── user.js             # User profile, password change, account deletion
│
├── middleware/
│   └── auth.js             # Minimal JWT auth — no suspension checks, no audit logs
│
└── services/               # Business logic
    ├── openrouter.js        # OpenRouter API — tool generation & iteration (conversational + JSON modes)
    ├── agentService.js      # Agent system prompt (40+ actions), LLM planning, task type classification,
    │                        #   research state, runaway detection, goal ledger, page-state diffing
    ├── agentCommands.js     # Slash-command handler (/help, /cancel, /new-task, /model, etc.)
    ├── agentTiers.js        # All users = super_agent tier + multi-agent council prompt
    ├── creditService.js     # No-ops — all costs return 0, all balance checks return true
    ├── webSearchService.js  # Multi-provider web search (Brave, SerpAPI, DuckDuckGo) + claim verification
    ├── memoryService.js     # Long-term memory — load, render, auto-extract, save direct (rememberThis)
    ├── domainRuleService.js # Per-domain rule loading + prompt rendering
    ├── pdfService.js        # PDF metadata, rasterization, text extraction, AcroForm fill
    ├── obsService.js        # S3-compatible storage (MinIO, R2, AWS S3) — optional
    ├── scheduleRunner.js    # Cron runner — 5-field parser, tick loop, spawns AgentTask
    ├── taskLock.js          # Per-task in-memory mutex
    ├── httpRetry.js         # fetch with exponential backoff + jitter
    ├── telegramService.js   # Telegram Bot API — sendMessage, getMe, parseUpdate
    ├── notificationService.js # Unified notify — Telegram immediate, WhatsApp in-memory queue
    └── featureFlags.js      # All features always enabled for self-hosted users
```

---

## What you need

1. Node.js 18+ (or 20+) — <https://nodejs.org>
2. An OpenRouter API key — <https://openrouter.ai/keys>
3. *(optional)* a MongoDB Atlas free cluster, only if you want your
   data persisted across deploys on Render's free tier.

---

## Run it locally

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# then open .env and set:
#   JWT_SECRET=<long random string>
#   OPENROUTER_API_KEY=<your key>

# 3. Start
npm start
# -> 🚀 Self-hosted API on http://localhost:3001
```

The extension expects the server at `https://api.global-order.32d.one`
by default. Point it to *your* server by editing **one line**:

`new order global/core/api-client.js`

```js
const BASE_URL = 'http://localhost:3001';   // for local
// or
const BASE_URL = 'https://your-server.onrender.com';
```

Then reload the extension in `chrome://extensions`. Open the
extension's sign-in screen, **register** an account (any email +
password) — that account exists only on *your* server — and you're
done. Credits will show as 999 999 (i.e. unlimited).

---

## Deploy to Render (free)

1. Push this folder to a GitHub repo of your own.
   *Make sure `.env` is **not** committed (it's already in
   `.gitignore`).*

2. <https://render.com> → **New → Web Service** → connect the repo.

3. Settings:
   | Field | Value |
   | --- | --- |
   | Runtime | Node |
   | Build command | `npm install` |
   | Start command | `npm start` |
   | Instance type | Free |

4. **Environment variables** (Render dashboard → Environment):

   | Key | Value |
   | --- | --- |
   | `JWT_SECRET` | a long random string |
   | `OPENROUTER_API_KEY` | `sk-or-v1-...` |
   | `OPENROUTER_MODEL` | `google/gemini-2.5-flash` (or any) |
   | `STORAGE` | `mongodb` *(recommended on Render — see below)* |
   | `MONGODB_URI` | your Atlas connection string |
   | `ALLOWED_ORIGINS` | `chrome-extension://<your-ext-id>` *(optional)* |

5. Deploy. Once green, copy the URL Render gives you
   (`https://your-server.onrender.com`) and paste it into the
   extension's `core/api-client.js` as `BASE_URL`.

> ⚠️ **Render's free disk is ephemeral.** If you use the default
> `STORAGE=file`, every redeploy/restart wipes your tools. For free
> Render hosting, use `STORAGE=mongodb` with a free MongoDB Atlas
> cluster — instructions at <https://www.mongodb.com/cloud/atlas/register>.
> For paid Render plans you can attach a persistent disk and keep
> `STORAGE=file`.

---

## Storage backends

| Backend | Set with | Where data lives | Good for |
| --- | --- | --- | --- |
| File (default) | `STORAGE=file` | `./data/*.json` | local dev, single PC |
| MongoDB | `STORAGE=mongodb` + `MONGODB_URI` | your Atlas cluster | cloud deploys |

Schemas are identical between the two; you can switch later.

Both backends expose the same API shape (see `storage/index.js` for the full list):
`db.users`, `db.tools`, `db.conversations`, `db.models`, `db.agentSettings`, `db.agentTasks`, `db.domainRules`, `db.integrations`, `db.onboarding`, `db.scheduledTasks`, `db.userMemory`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `JWT_SECRET` | **Yes** | Strong random secret for JWT signing |
| `OPENROUTER_API_KEY` | **Yes** | OpenRouter API key (`sk-or-v1-...`) |
| `OPENROUTER_MODEL` | No | Default model fallback (default: `google/gemini-2.5-flash`) |
| `OPENROUTER_REFERER` | No | Shown in OpenRouter dashboard (default: `http://localhost:3001`) |
| `OPENROUTER_APP_TITLE` | No | App title for OpenRouter (default: `New Order Self-Hosted`) |
| `STORAGE` | No | `file` (default) or `mongodb` |
| `DATA_DIR` | No | Directory for file storage (default: `./data`) |
| `MONGODB_URI` | If `STORAGE=mongodb` | MongoDB connection string |
| `ALLOW_REGISTER` | No | Set to `false` to disable new signups (default: `true`) |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (empty = allow all) |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token for agent notifications |
| `OBS_ENDPOINT` | No | S3-compatible endpoint for screenshots/captures |
| `OBS_ACCESS_KEY` | No | S3 access key |
| `OBS_SECRET_KEY` | No | S3 secret key |
| `OBS_BUCKET` | No | S3 bucket name |
| `OBS_REGION` | No | S3 region (default: `auto`) |
| `OBS_SCREENSHOT_TTL_MINUTES` | No | Screenshot auto-delete time (default: 10) |
| `OBS_CAPTURE_TTL_DAYS` | No | Captured file auto-delete time (default: 7) |
| `BRAVE_SEARCH_API_KEY` | No | Brave Search API key (primary web search) |
| `SERPAPI_KEY` | No | SerpAPI key (secondary Google search) |
| `RUN_SCHEDULER` | No | Set to `0` to disable the cron schedule runner |

---

## Adding/removing AI models

Edit [`storage/default-models.js`](./storage/default-models.js).
Each entry sets:

- `modelId` — what the extension stores ("gemini-2-5-flash")
- `openRouterId` — what gets sent to OpenRouter ("google/gemini-2.5-flash")
- `name` / `description` — shown in the model picker
- `isDefault: true` — used when the extension doesn't pick one
- `isEnabled: false` — hides it

Restart the server after editing.

---

## API Endpoints

The API surface is compatible with the upstream server, so the extension works without any changes.

### Auth (`/api/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Create account (unlimited credits) |
| POST | `/api/auth/login` | — | Sign in |
| GET | `/api/auth/profile` | JWT | Get user profile |
| PUT | `/api/auth/profile` | JWT | Update display name |
| POST | `/api/auth/change-password` | JWT | Change password |

### AI (`/api/ai`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/ai/generate` | JWT | Generate a new tool from prompt (conversational or JSON) |
| POST | `/api/ai/iterate` | JWT | Modify an existing tool via feedback (conversational or JSON) |
| POST | `/api/ai/estimate` | JWT | Estimate credit cost (always returns 0) |
| POST | `/api/ai/generate-stream` | JWT | Stream tool generation (SSE) |
| POST | `/api/ai/iterate-stream` | JWT | Stream tool iteration (SSE) |

### Tools (`/api/tools`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tools` | JWT | List user's tools |
| GET | `/api/tools/:id` | JWT | Get specific tool |
| POST | `/api/tools` | JWT | Save/activate a tool |
| PUT | `/api/tools/:id` | JWT | Update a tool |
| DELETE | `/api/tools/:id` | JWT | Delete a tool |

### Conversations (`/api/conversations`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/conversations` | JWT | List user's conversations |
| POST | `/api/conversations` | JWT | Create a conversation |
| GET | `/api/conversations/:id` | JWT | Get conversation with messages |
| DELETE | `/api/conversations/:id` | JWT | Delete a conversation |

### Billing (`/api/billing`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/billing/credits` | JWT | Credit balance (always 999999) |
| GET | `/api/billing/purchases` | JWT | Purchase history (empty) |
| POST | `/api/billing/checkout` | JWT | Disabled (returns 501) |
| POST | `/api/billing/subscribe` | JWT | Disabled (returns 501) |
| POST | `/api/billing/cancel-subscription` | JWT | Disabled (returns 501) |

### Models (`/api/models`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/models` | JWT | List enabled AI models |

### Agent (`/api/agent`) — Global Executive

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/agent/plan` | JWT | Phase-0: produce a plan + required inputs |
| POST | `/api/agent/brief` | JWT | Submit briefing answers + permissions, start the run |
| POST | `/api/agent/start` | JWT | Start a new agent task (legacy direct path) |
| POST | `/api/agent/step` | JWT | Report action result, get next action from LLM |
| POST | `/api/agent/answer` | JWT | Reply to askUser / confirmAction prompts |
| POST | `/api/agent/stop` | JWT | Cancel a running task |
| GET | `/api/agent/tasks` | JWT | List user's past tasks |
| GET | `/api/agent/tasks/:id` | JWT | Get full task details with all steps |
| GET | `/api/agent/tier` | JWT | Get current user's agent tier (always super_agent) |
| GET | `/api/agent/pending-chat-reply` | JWT | Drain one pending Telegram/WhatsApp reply |
| POST | `/api/agent/screenshot` | JWT | Upload a screenshot (requires OBS config) |
| POST | `/api/agent/captureFile` | JWT | Upload a captured file (requires OBS config) |

### Agent Settings, Memory, Domain Rules, Scheduled Tasks (`/api`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/agent-settings` | JWT | Get agent settings + super_agent tier ceilings |
| PUT | `/api/agent-settings` | JWT | Upsert agent settings (clamped to super_agent ceilings) |
| GET | `/api/memory` | JWT | List all memories |
| POST | `/api/memory` | JWT | Add a memory manually |
| PUT | `/api/memory/:id` | JWT | Edit memory |
| DELETE | `/api/memory/:id` | JWT | Delete one memory |
| POST | `/api/memory/:id/confirm` | JWT | Promote pending → active |
| DELETE | `/api/memory` | JWT | Bulk wipe all memories |
| GET | `/api/domain-rules` | JWT | List per-domain rules |
| POST | `/api/domain-rules` | JWT | Create a domain rule |
| PUT | `/api/domain-rules/:id` | JWT | Update a domain rule |
| DELETE | `/api/domain-rules/:id` | JWT | Delete a domain rule |
| GET | `/api/scheduled-tasks` | JWT | List scheduled tasks |
| POST | `/api/scheduled-tasks` | JWT | Create a scheduled task |
| PUT | `/api/scheduled-tasks/:id` | JWT | Update a scheduled task |
| DELETE | `/api/scheduled-tasks/:id` | JWT | Delete a scheduled task |

### Integrations (`/api/integrations`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/integrations` | JWT | Current integration setup |
| PUT | `/api/integrations/preferences` | JWT | Update notification preferences |
| POST | `/api/integrations/telegram/setup` | JWT | Link a Telegram bot |
| POST | `/api/integrations/telegram/unlink` | JWT | Remove Telegram bot link |
| POST | `/api/integrations/telegram/webhook/:botId` | — | Telegram webhook receiver (public) |
| POST | `/api/integrations/whatsapp/setup` | JWT | Enable WhatsApp group |
| POST | `/api/integrations/whatsapp/verify` | JWT | Confirm WhatsApp group |
| POST | `/api/integrations/whatsapp/unlink` | JWT | Remove WhatsApp link |
| POST | `/api/integrations/whatsapp/incoming` | JWT | Receive WhatsApp message from content script |
| GET | `/api/integrations/whatsapp/outbox` | JWT | Pop queued outbound WhatsApp messages |
| GET | `/api/integrations/inbox` | JWT | Poll for queued Telegram/WhatsApp task prompts |
| POST | `/api/integrations/test` | JWT | Send a test message |

### Onboarding (`/api/onboarding`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/onboarding` | JWT | Get onboarding progress |
| PUT | `/api/onboarding` | JWT | Update onboarding step |

### User (`/api/user`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/user/profile` | JWT | Extended user profile |
| PUT | `/api/user/profile` | JWT | Update profile fields |
| POST | `/api/user/change-password` | JWT | Change password |
| DELETE | `/api/user/account` | JWT | Delete account and all data |

### Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Service health check |

---

## What was removed from the original server

If you're cross-referencing the proprietary server, here is the diff in plain English:

- ❌ Lemon Squeezy checkout + webhook routes
- ❌ Credit pricing, deduction, atomic transactions
- ❌ Daily request caps, per-user/IP rate limits
- ❌ Audit-log collection
- ❌ Account suspension / admin routes
- ❌ Helmet + strict CORS lockdown (replaced with permissive defaults)
- ❌ Hard-coded references to `global-order.32d.one`
- ❌ Huawei Cloud OBS SDK (replaced with S3-compatible SDK)
- ❌ AES-256-GCM encryption for Telegram bot tokens (stored as plaintext)
- ❌ Dormancy sweep (idle task auto-close)
- ➕ File-based JSON storage backend (no DB needed)
- ➕ `STORAGE` env to switch between file and MongoDB
- ➕ `ALLOW_REGISTER=false` to lock down registration after first signup
- ➕ All users get super_agent tier with maximum limits
- ➕ S3-compatible object storage (works with MinIO, Cloudflare R2, AWS S3)

---

## License

MIT — see [LICENSE](./LICENSE).

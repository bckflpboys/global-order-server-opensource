# New Order Global — Self-Hosted Server

This is the **open-source backend** that pairs with the
[New Order Global](https://github.com/) Chrome extension. It is the
*minimal* server you need to make the extension work — auth + AI
generation, nothing more.

It is intentionally tiny and easy to audit. It does **not**:

- charge anyone or talk to any payment provider
- rate-limit you
- send telemetry anywhere
- require any third-party service except [OpenRouter](https://openrouter.ai)
- require MongoDB (it can run with plain JSON files)

If you can read ~700 lines of plain Express code, you can verify
exactly what it does.

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

## Endpoints

The API surface is identical to the upstream server, so the extension
works without any other changes:

```
POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/profile
PUT    /api/auth/profile
POST   /api/auth/change-password

POST   /api/ai/generate
POST   /api/ai/iterate
POST   /api/ai/estimate

GET    /api/tools
GET    /api/tools/:id
POST   /api/tools
PUT    /api/tools/:id
DELETE /api/tools/:id

GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id

GET    /api/billing/credits   # always returns 999999
POST   /api/billing/checkout  # disabled (501)

GET    /api/models

GET    /api/health
```

---

## What was removed from the original server

If you're cross-referencing the proprietary server, here is the
diff in plain English:

- ❌ Lemon Squeezy checkout + webhook routes
- ❌ Credit pricing, deduction, atomic transactions
- ❌ Daily request caps, per-user/IP rate limits
- ❌ Audit-log collection
- ❌ Account suspension / admin routes
- ❌ Helmet + strict CORS lockdown (replaced with permissive defaults)
- ❌ Hard-coded references to `global-order.32d.one`
- ➕ File-based JSON storage backend (no DB needed)
- ➕ `STORAGE` env to switch between file and MongoDB
- ➕ `ALLOW_REGISTER=false` to lock down registration after first signup

---

## License

MIT. Use it, break it, fork it.

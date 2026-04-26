# New Order Global — Self-Hosted Server v1.0.0

> Open-source, self-hosted backend for the **[New Order Global](https://github.com/bckflpboys/new-order-global)** Chrome extension. A minimal Node.js / Express API that proxies AI tool generation through OpenRouter using **your own API key**.

This is the companion server to the New Order Global Chrome extension. Run it on your own machine (or any cheap VPS) and you get unlimited AI-powered tool building — you only pay OpenRouter for the tokens you use.

---

## What This Server Does

- 🔐 **Authenticates users** with JWT (bcrypt-hashed passwords)
- 🤖 **Proxies AI generation** to OpenRouter using your API key
- 💾 **Stores tools and conversations** — JSON files by default, MongoDB optionally
- 🎯 **Multi-model support** — pick any OpenRouter model the extension supports

## What This Server Does NOT Do

- ❌ No payment processing, no credits, no billing
- ❌ No rate limiting, no usage quotas
- ❌ No telemetry, no audit logs, no admin routes
- ❌ No third-party calls beyond OpenRouter

You bring your own OpenRouter API key. Use the AI as much as you want.

---

## Features

- **Minimal footprint** — Express + a few hundred lines of code, no heavy frameworks
- **File-based storage by default** — JSON files in `./data`, no database setup required
- **Optional MongoDB** — set `STORAGE=mongodb` for multi-device sync
- **Registration lockdown** — set `ALLOW_REGISTER=false` after creating your account
- **CORS allowlist** — restrict to your specific Chrome extension ID
- **No build step** — pure Node.js, runs directly with `node server.js`
- **Node 18+** — uses native `fetch`, no extra HTTP libs

---

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
JWT_SECRET=<generate a long random string>
OPENROUTER_API_KEY=sk-or-v1-...
```

Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 3. Run

```bash
npm run dev    # Development (auto-reload via --watch)
npm start      # Production
```

Server starts on `http://localhost:3001`. Health check: `http://localhost:3001/api/health`

### 4. Connect the Extension

In the [New Order Global extension](https://github.com/bckflpboys/new-order-global), edit `core/api-client.js` and set:

```js
const BASE_URL = 'http://localhost:3001';
```

Then load the extension in `chrome://extensions/` (Developer mode → Load unpacked).

---

## Configuration Reference

### Required

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Long random string used to sign auth tokens |
| `OPENROUTER_API_KEY` | Your OpenRouter API key — https://openrouter.ai/keys |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP port |
| `OPENROUTER_MODEL` | `google/gemini-2.5-flash` | Default model when client doesn't specify |
| `STORAGE` | `file` | `file` (JSON files) or `mongodb` |
| `DATA_DIR` | `./data` | Directory for file storage |
| `MONGODB_URI` | — | Required only if `STORAGE=mongodb` |
| `ALLOW_REGISTER` | `true` | Set to `false` to disable account creation |
| `ALLOWED_ORIGINS` | empty (allow all) | Comma-separated CORS allowlist |
| `OPENROUTER_REFERER` | `http://localhost:3001` | Shown in your OpenRouter dashboard |
| `OPENROUTER_APP_TITLE` | `New Order Self-Hosted` | Shown in your OpenRouter dashboard |

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | — | Health check |
| POST | `/api/auth/register` | — | Create account |
| POST | `/api/auth/login` | — | Sign in |
| GET | `/api/auth/profile` | JWT | Get profile |
| GET | `/api/models` | JWT | List available AI models |
| POST | `/api/ai/generate` | JWT | Generate a new tool from a prompt |
| POST | `/api/ai/iterate` | JWT | Modify an existing tool via feedback |
| GET | `/api/tools` | JWT | List your tools |
| GET | `/api/tools/:id` | JWT | Get a specific tool |
| POST | `/api/tools` | JWT | Save a tool |
| PUT | `/api/tools/:id` | JWT | Update a tool |
| DELETE | `/api/tools/:id` | JWT | Delete a tool |
| GET | `/api/conversations` | JWT | List your conversations |
| GET | `/api/conversations/:id` | JWT | Get a conversation |
| DELETE | `/api/conversations/:id` | JWT | Delete a conversation |

---

## Storage Backends

### File Storage (default)

Stores everything in JSON files inside `DATA_DIR`. Zero setup. Best for personal use on a single machine.

```env
STORAGE=file
DATA_DIR=./data
```

### MongoDB (optional)

Use MongoDB for multi-device sync or if you're hosting publicly.

```env
STORAGE=mongodb
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/neworder
```

The `mongoose` package is an `optionalDependency` — it only loads if you select MongoDB.

---

## Security Notes

- **Never commit** your `.env` file
- Generate a **strong, random** `JWT_SECRET` for any deployment
- After registering your own account, set `ALLOW_REGISTER=false` to disable further sign-ups
- If you expose this server publicly, set `ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID`
- This server has **no built-in rate limiting** — if exposed publicly, put it behind a reverse proxy (nginx, Caddy, Cloudflare) with rate limits

---

## Requirements

- **Node.js** 18 or higher
- **OpenRouter** account + API key
- **MongoDB** — *only* if you set `STORAGE=mongodb`

---

## Companion Project

This server is the backend for the **[New Order Global Chrome Extension](https://github.com/bckflpboys/new-order-global)**. Both projects are versioned together.

---

## Tech Stack

- Node.js, Express 4
- JWT (jsonwebtoken), bcryptjs
- OpenRouter (via native `fetch`)
- File storage (default) or Mongoose 8 (optional)

---

## License

MIT

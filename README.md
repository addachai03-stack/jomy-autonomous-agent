# JOMY Autonomous Agent

Standalone, compact, iPhone-first voice interface with a humanoid-inspired animated orb. This repository is separate from `JOMY-ORCHESTRA`.

## UI
- Black-and-gold compact mobile UI and animated ready/listening/thinking/speaking orb states.
- Browser speech recognition where available; iPhone keyboard dictation fallback.
- Optional hands-free wake-word mode (off by default), tested Hindi/Hinglish wake-word parsing, auto-send after wake + command, and spoken replies that resume listening when supported.
- Collapsible conversation, session-only Agent owner token and dedicated JOMY MCP Client token fields.
- Installable PWA shell and offline caching for static assets.

## Backend API (source only; not deployed)
A standalone Cloudflare Worker API source copy lives in `src/worker.js`; the existing API Worker is managed and deployed separately. It provides owner bearer-token authentication, Cloudflare Workers AI chat, and a server-side bridge to the existing JOMY Personal MCP endpoint. The bridge supports read-only system/Telegram status and preparing a Telegram message for owner approval. It never approves or executes the send. The MCP Client token is sent only to the authenticated Worker over HTTPS and is not persisted by the Worker.

### Required Worker configuration
1. Enable the Workers AI binding in Cloudflare.
2. Set the Worker secret `AGENT_OWNER_TOKEN`. It must be a new, unique random secret (at least 32 characters). On iPhone, generate it with a trusted password manager's random-password generator and save it privately. Never paste the secret into GitHub, chat, or the app's public source.
3. Set `ALLOWED_ORIGIN` to the exact HTTPS origin hosting this standalone UI.
4. Deploy only after separate explicit deployment approval.

The model source is `@cf/openai/gpt-oss-20b` through Workers AI. Keep this source aligned with the separately managed Worker deployment. Confirm account availability and free daily allowance in Cloudflare first; usage beyond any free allowance may be billable.

## Local API development
Requires Node.js/npm and Wrangler. Run `npm install`, configure the local secret and AI binding, then `npm run dev:api`. Health endpoint: `/health`; chat endpoint: `POST /api/agent/chat`.

The browser sends `Authorization: Bearer <agent owner token>` plus JSON `{ "message": "...", "sessionId": "...", "locale": "hi-IN", "client": "jomy-autonomous-agent" }`. The Worker returns `{ "reply": "...", "status": "ready" }`. For MCP requests, the browser sends the dedicated MCP Client token in the body to the authenticated Agent Worker; the Worker proxies it to the fixed existing MCP endpoint. Supported routes are status and Telegram prepare-only. A clear command such as `Telegram par bhejo: ...` creates a five-minute pending approval; it does not send a message. The owner must approve it in the separate JOMY MCP Admin PWA.

## Safety and scope
- Backend is source-only until deployed and configured.
- MCP integration is limited to status and Telegram message preparation pending owner approval. No automatic Telegram sends, email, Calendar, WhatsApp, phone-control, financial actions, or arbitrary task execution.
- No task is reported completed without trusted confirmation.
- Credentials remain in server-side secret storage; owner API token is entered locally on the user's device.
- No dashboard files, databases, or production services are changed by this repository work.

Voice recognition is browser-dependent. Enable Hands-free with a user tap; if Safari pauses microphone startup, tap the Hands-free button again to retry. Some iPhone Safari versions do not expose the Web Speech Recognition API; use iOS keyboard dictation in the message field in that case. iOS may suspend listening in the background or while the screen is locked, so always-on background wake-word listening is not guaranteed.

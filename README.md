# JOMY Autonomous Agent

Standalone, compact, iPhone-first voice interface with a humanoid-inspired animated orb. This repository is separate from `JOMY-ORCHESTRA`.

## UI
- Black-and-gold compact mobile UI and animated ready/listening/thinking/speaking orb states.
- Browser speech recognition where available; iPhone keyboard dictation fallback.
- Spoken replies using browser speech synthesis where available.
- Collapsible conversation and locally stored endpoint + owner access token.
- Installable PWA shell and offline caching for static assets.

## Backend API (source only; not deployed)
A standalone Cloudflare Worker API source copy lives in `src/worker.js`; the existing API Worker is managed and deployed separately. It provides owner bearer-token authentication and Cloudflare Workers AI chat. It has no MCP integration, Telegram integration, external service tools, financial actions, secret changes, deletes, or deployments.

### Required Worker configuration
1. Enable the Workers AI binding in Cloudflare.
2. Set the Worker secret `AGENT_OWNER_TOKEN`. It must be a new, unique random secret (at least 32 characters). On iPhone, generate it with a trusted password manager's random-password generator and save it privately. Never paste the secret into GitHub, chat, or the app's public source.
3. Set `ALLOWED_ORIGIN` to the exact HTTPS origin hosting this standalone UI.
4. Deploy only after separate explicit deployment approval.

The model source is `@cf/openai/gpt-oss-20b` through Workers AI. Keep this source aligned with the separately managed Worker deployment. Confirm account availability and free daily allowance in Cloudflare first; usage beyond any free allowance may be billable.

## Local API development
Requires Node.js/npm and Wrangler. Run `npm install`, configure the local secret and AI binding, then `npm run dev:api`. Health endpoint: `/health`; chat endpoint: `POST /api/agent/chat`.

The browser sends `Authorization: Bearer <owner token>` plus JSON `{ "message": "...", "sessionId": "...", "locale": "hi-IN", "client": "jomy-autonomous-agent" }`. The Worker returns `{ "reply": "...", "status": "ready" }`.

## Safety and scope
- Backend is source-only until deployed and configured.
- Standalone AI chat only; no Telegram, MCP, or other connected-service access.
- No task is reported completed without trusted confirmation.
- Credentials remain in server-side secret storage; owner API token is entered locally on the user's device.
- No dashboard files, databases, or production services are changed by this repository work.

Voice recognition is browser-dependent. Some iPhone Safari versions do not expose the Web Speech Recognition API; use iOS keyboard dictation in the message field in that case.

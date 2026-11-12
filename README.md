# JOMY Autonomous Agent

Standalone, compact, iPhone-first voice interface with a humanoid-inspired animated orb. This repository is separate from `JOMY-ORCHESTRA`.

## UI
- Black-and-gold compact mobile UI and animated ready/listening/thinking/speaking orb states.
- Browser speech recognition where available; iPhone keyboard dictation fallback.
- Spoken replies using browser speech synthesis where available.
- Collapsible conversation and locally stored endpoint + owner access token.
- Installable PWA shell and offline caching for static assets.

## Backend API (source only; not deployed)
A Cloudflare Worker API lives in `src/worker.js`. It provides owner bearer-token authentication, Cloudflare Workers AI chat, and optional read-only status lookups against the existing JOMY PERSONAL MCP. MCP access is limited to `system_status` and `telegram_status`. It has no write-capable tools, financial actions, secret changes, deletes, or deployments.

### Required Worker configuration
1. Enable the Workers AI binding in Cloudflare.
2. Set Worker secrets `AGENT_OWNER_TOKEN` and `MCP_CLIENT_TOKEN`. `AGENT_OWNER_TOKEN` must be a new, unique random secret (at least 32 characters); do not reuse the MCP token. `MCP_CLIENT_TOKEN` is the separate client-scoped token created for `jomy-autonomous-agent`, never the MCP owner token. On iPhone, generate the owner secret with a trusted password manager's random-password generator, use at least 32 characters, and save it privately. Never paste either secret into GitHub, chat, or the app's public source.
3. Set `ALLOWED_ORIGIN` to the exact HTTPS origin hosting this standalone UI.
4. Keep `MCP_URL` pointed at the existing JOMY PERSONAL MCP `/mcp` endpoint.
5. Deploy only after separate explicit deployment approval.

The model uses `@cf/meta/llama-3.1-8b-instruct` through Workers AI. Confirm account availability and free daily allowance in Cloudflare first; usage beyond any free allowance may be billable.

## Local API development
Requires Node.js/npm and Wrangler. Run `npm install`, configure local secrets and AI binding, then `npm run dev:api`. Health endpoint: `/health`; chat endpoint: `POST /api/agent/chat`.

The browser sends `Authorization: Bearer <owner token>` plus JSON `{ "message": "...", "sessionId": "...", "locale": "hi-IN", "client": "jomy-autonomous-agent" }`. The Worker returns `{ "reply": "...", "status": "ready|connected" }`.

## Safety and scope
- Backend is source-only until deployed and configured.
- MCP access is read-only and limited to `system_status` and `telegram_status`.
- No task is reported completed without trusted confirmation.
- Credentials remain in server-side secret storage; owner API token is entered locally on the user's device.
- No dashboard files, databases, or production services are changed by this repository work.

Voice recognition is browser-dependent. Some iPhone Safari versions do not expose the Web Speech Recognition API; use iOS keyboard dictation in the message field in that case.

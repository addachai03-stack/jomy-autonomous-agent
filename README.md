# JOMY Autonomous Agent

JOMY is a private, iPhone-first Hindi/Hinglish AI chat and task-planning PWA with a humanoid-inspired animated orb and optional voice input.

## Current capabilities
- Black-and-gold mobile interface with ready, listening, thinking and speaking states.
- Text chat through the separately deployed Cloudflare Worker API.
- Tap-to-speak where the browser supports Web Speech Recognition; iPhone keyboard dictation is the fallback.
- Optional hands-free wake phrase mode. It is opt-in, requires the page to stay open, and depends on browser speech-recognition support.
- Local task queue (up to 30 items), task planning, retry and status display. Task records are stored on this device.
- Personal memory (up to 15 short facts) stored only in this browser on this device. Facts are sent as limited chat context; users can add/remove facts. Explicit “Mera naam … hai” and “Yaad rakho …” statements are captured locally. Credential-like facts such as passwords, OTPs, tokens, card security codes and Aadhaar/PAN numbers are rejected.
- Installable PWA shell with cached static assets.

## API
The PWA default endpoint is:

`https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat`

The standalone Worker source is `src/worker.js`. It exposes:
- `GET /health` — configuration readiness status.
- `POST /api/agent/chat` — authenticated chat.
- `POST /api/agent/plan` — authenticated task-plan generation.

The browser sends JSON over HTTPS and the owner bearer token in the Authorization header. The token is held in session storage on this device; it must never be committed to source or shared in chat. The Worker uses the Workers AI binding and an `AGENT_OWNER_TOKEN` secret. `ALLOWED_ORIGIN` must match the production PWA origin.

## Task queue behavior
Tasks can be added from the task panel or by sending `Task: …` in chat. If a request is generic (for example, `Kal ke 3 important kaam ka plan banao`) and gives no actual task names, JOMY requests those details with an inline `SAVE & PLAN` form rather than fabricating meetings or projects. Chat requests without real task names also ask for clarification. Submitted details remain local on the device until sent to the authenticated planning API. Previously saved task titles and plans are not rewritten. JOMY generates a suggested plan; it does not execute external actions. Plans that require messaging, financial actions, purchases, publishing, deletion, or account changes are marked unsupported/blocked. No task is reported completed without trusted confirmation.

## Safety boundaries
- No MCP bridge or Telegram integration is exposed by this Agent.
- No email, Calendar, WhatsApp, phone-control, financial actions, purchases, publishing, deletion, or arbitrary external execution.
- The separate JOMY Personal MCP service is independent and is not modified by this repository.
- Personal memory is local browser storage, not encrypted cloud sync or a server-side account profile. Clearing browser site data removes it. Do not store passwords, OTPs, tokens, financial credentials or sensitive identifiers.
- No secrets, database records, or external account credentials belong in the repository.
- Production Worker and Pages deployments require separate explicit approval.

## Local development and checks
Requires Node.js/npm and Wrangler:

```sh
npm install
npm test
npm run check:api
npm run dev:api
```

Configure the Workers AI binding, `AGENT_OWNER_TOKEN`, and `ALLOWED_ORIGIN` locally before testing the Worker. Never commit secret values.

## Voice limitations
Voice recognition is browser-dependent. Hands-free begins only after a user tap and microphone permission. Some iPhone Safari versions do not expose the Web Speech Recognition API; use the iOS keyboard microphone in the message field if voice recognition is unavailable. When the PWA is backgrounded, JOMY pauses recognition and attempts to resume after the page returns to the foreground. iOS may suspend microphone access or speech recognition while backgrounded or locked, so always-on background wake-word listening is not guaranteed.

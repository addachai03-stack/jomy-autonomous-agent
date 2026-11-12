# JOMY Autonomous Agent

Standalone, compact, iPhone-first voice interface with a humanoid-inspired animated orb. This repository is separate from `JOMY-ORCHESTRA`.

## MVP included
- Black-and-gold compact mobile UI and animated ready/listening/thinking/speaking orb states.
- Browser speech recognition where available; iPhone keyboard dictation fallback.
- Spoken replies using browser speech synthesis where available.
- Collapsible recent conversation and locally stored endpoint preference.
- Installable PWA shell and offline caching for static assets.

## Run locally
Serve this folder over HTTP (microphone and service worker require localhost or HTTPS). Example: `python3 -m http.server 8080`.

## API contract
Set an HTTPS endpoint using the gear button. The browser sends JSON:
```json
{"message":"User command","sessionId":"browser session id","locale":"hi-IN","client":"jomy-autonomous-agent"}
```
The endpoint must return JSON containing a non-empty `reply` string:
```json
{"reply":"Namaste. Main aapki request samajh raha hoon."}
```

The current repository is the voice-first interface and API client, **not a connected LLM/tool-execution backend**. No dashboard integration or external actions are active yet. The frontend never stores provider keys. Keep model keys, GitHub tokens, Cloudflare tokens and MCP credentials on a trusted server.

## Required backend safety
- Owner authentication and authorization.
- Read-only inspection by default.
- Explicit owner approval for code changes, deployments, financial actions, secret changes, deletion and external messages.
- Scoped credentials and audit logging.
- Report completion only after the trusted backend confirms the action.
- Connect to JOMY AUTOPILOT X through a narrow authenticated API only after this standalone app is verified.

Voice recognition is browser-dependent. Some iPhone Safari versions do not expose the Web Speech Recognition API; use iOS keyboard dictation in the message field in that case.
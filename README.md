# JOMY Autonomous Agent

JOMY is a private, iPhone-first Hindi/Hinglish AI chat and task-planning PWA with a humanoid-inspired animated orb and optional voice input.

## Current capabilities
- Black-and-gold mobile interface with ready, listening, thinking and speaking states.
- Text chat through the separately deployed Cloudflare Worker API.
- Tap-to-speak where the browser supports Web Speech Recognition; iPhone keyboard dictation is the fallback.
- Optional hands-free wake phrase mode. It is opt-in, requires the page to stay open, and depends on browser speech-recognition support.
- Local task queue (up to 30 items), task planning, retry and status display. Task records are stored on this device.
- Personal memory (up to 15 short facts) stored only in this browser on this device. Facts are sent as limited chat context; users can add/remove facts. Explicit “Mera naam … hai” and “Yaad rakho …” statements are captured locally. Credential-like facts such as passwords, OTPs, tokens, card security codes and Aadhaar/PAN numbers are rejected.
- Installable PWA shell with offline fallback for static assets. PWA cache v41 uses versioned app.js/styles.css URLs and network-first loading for the shell to avoid an old Safari service worker mixing newer HTML with older scripts/styles; existing device-local tasks, checklists, memories, and tokens are not cleared.

## API
The PWA default endpoint is:

`https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat`

The standalone Worker source is `src/worker.js`. It exposes:
- `GET /health` — configuration readiness status.
- `POST /api/agent/chat` — authenticated chat.
- `POST /api/agent/plan` — authenticated task-plan generation.

The browser sends JSON over HTTPS and the owner bearer token in the Authorization header. The token is held in session storage on this device; it must never be committed to source or shared in chat. The Worker uses the Workers AI binding and an `AGENT_OWNER_TOKEN` secret. `ALLOWED_ORIGIN` must match the production PWA origin.

## Task queue behavior
Tasks can be added from the task panel or by sending `Task: …` in chat. If a request is generic (for example, `Kal ke 3 important kaam ka plan banao`) and gives no actual task names, JOMY requests those details with an inline `SAVE & PLAN` form rather than fabricating meetings or projects. Chat requests without real task names also ask for clarification. Submitted details remain local on the device until sent to the authenticated planning API. Previously saved task titles and plans are not rewritten. JOMY generates a suggested plan; it does not execute external actions. Plans that require messaging, financial actions, purchases, publishing, deletion, or account changes are marked unsupported/blocked. No task is reported completed without trusted confirmation. The owner can manually mark a READY plan as IN PROGRESS or DONE, pause it back to READY, and REOPEN a manually done task. Manual statuses persist on the same iPhone across refreshes and do not use or imply an external integration, execution, or automated verification. Task Queue 2.2 adds a per-step, manually checked checklist for READY, IN PROGRESS, and DONE plans. Checkmarks and an x/y progress meter are stored with the task on this device, survive refreshes, and stay with the plan when the owner pauses/reopens it. Marking all steps checked never automatically changes the task to DONE or executes anything. If a plan is replaced, its prior checkmarks are cleared instead of being mapped onto unrelated steps. Task Queue 2.3 adds a live dashboard showing Total, Pending, In Progress, and Done, with tappable cards that filter the same local task list without editing its records. Pending includes not-started, waiting, failed, and blocked tasks; In Progress includes manually started and legacy running tasks; Done includes manually completed and legacy succeeded tasks. The dashboard refreshes its counts on adds, updates, deletes, checklist checks, and task transitions. New tasks automatically switch the filter back to Total so they remain visible. Task data, user-set statuses, and checklist progress remain intact. Task Queue 2.4 provides a device-local name/details search field and Newest/Oldest sorting. Both work together with status filter cards, without modifying saved task order, plans, checkmarks, statuses or storage keys. Search resets when a new task is added so the new task stays visible. Search/sort choices are view-only and reset on refresh; the tasks themselves remain saved. Task Queue 2.5 adds optional manual per-task priority (Not set / High / Medium / Low) and due date, displayed on each task card and persisted with existing device-local task records. Existing tasks default to Not set and no due date, and editing either field does not alter status, checklist, or task plan. No alerts, reminders, automatic completion or external scheduling are created by selecting a due date. Task Queue 2.6 adds read-only ALL DATES / DUE TODAY / OVERDUE filters and live counts based on the device-local calendar day. Tasks marked DONE or legacy SUCCEEDED are excluded from due/overdue counts, while unfinished READY/IN PROGRESS/FAILED/BLOCKED tasks with assigned due dates remain visible. Priority first sorts High, Medium, Low, then Not set (newest first within equal priority), and combines with status filters and text search. Task cards display a DUE TODAY or OVERDUE indicator; views recalculate when Safari becomes visible again. This does not create alerts, background monitoring, or automatic work. Task Queue 2.7 adds an opt-in device-local JSON Backup & Restore drawer. Export downloads only an allowlisted copy of tasks (title, owner details, plan summary, checklist, manual status, priority and due date) and **never** includes the Owner Token, connection settings or Personal Memory. Restore accepts versioned JOMY Task Queue JSON up to 512 KB with at most 30 tasks, validates records, previews new/duplicate/over-limit counts and asks for explicit confirmation before writing. Import appends only new task IDs into remaining free slots, never overwrites or truncates existing tasks. In-progress/unsafe legacy execution statuses import as FAILED requiring manual review, and imported plans cannot execute external actions. Backups may contain private task content—store JSON files privately on the iPhone. Preview and Production run at different origins, so downloads must be intentionally shared via Files to move tasks. Task Queue 2.8 adds a collapsed per-task NOTES & TAGS editor: manually saved private notes up to 1,000 characters and up to five comma-separated tags (each up to 24 characters). Tags and notes are searchable with Task Queue 2.4, displayed as text-only pills and preserved in allowlisted 2.7 JSON backups. Changes write to the existing device-local task record before showing a success message, never trigger planning/execution, and do not affect progress, status, priority, due dates, Personal Memory, or authentication. Notes and tags are private content; do not put tokens, passwords, OTPs or sensitive credentials there, and keep exported JSON files private. Task Queue 2.9 adds up to 10 reusable manual task templates, stored separately under `jomy_agent_task_templates_v1`. Every saved task offers SAVE TEMPLATE, and a collapsed MY TASK TEMPLATES drawer offers USE and confirmed REMOVE. Templates preserve only task title, checklist steps, priority and tags; they exclude notes, details, due dates, progress checkmarks, status, tokens, plans and external actions. USE creates a fresh READY manual task, with unchecked checklist, no due date, no AI planning or execution, and refuses when the 30-task queue is full (no record is evicted). Deleting a template requires confirmation and never deletes any task. Existing task storage (`jomy_agent_task_queue_v1`) and Personal Memory remain unchanged. Template storage is local to each browser origin and is not included in the separate Task Queue 2.7 JSON task backup. The PWA shell uses cache v47 with versioned app.js and styles.css.

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

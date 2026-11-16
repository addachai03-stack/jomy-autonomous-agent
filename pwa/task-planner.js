const ACTION_TYPES = new Set(["none", "unsupported"]);

export function parseTaskPlan(raw, taskTitle) {
  if (typeof raw !== "string" || raw.length > 12000) throw new TypeError("Planner response is missing or too long.");
  const cleaned = raw.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "").replace(/\s*\u0060\u0060\u0060$/, "");
  let value;
  try { value = JSON.parse(cleaned); } catch { throw new TypeError("Planner response was not valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Planner response must be an object.");
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  if (!summary || summary.length > 240) throw new TypeError("Planner summary must be 1–240 characters.");
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 8 ||
      value.steps.some(step => typeof step !== "string" || !step.trim() || step.length > 240)) {
    throw new TypeError("Planner must return 1–8 short steps.");
  }
  let actionType = ACTION_TYPES.has(value.actionType) ? value.actionType : "unsupported";
  if (actionType !== "none") actionType = "unsupported";
  return {
    summary,
    steps: value.steps.map(step => step.trim()),
    actionType,
    requiresApproval: actionType === "unsupported"
  };
}

/**
 * Spot short, generic planning requests that contain no actual tasks.
 * This conservative local guard prevents the planner from fabricating a
 * project, client meeting or deadline when the user has named none.
 * Specific project requests and lists of real work still reach the API.
 */
export function needsTaskDetails(raw) {
  if (typeof raw !== "string" || !raw.trim()) return true;
  const text = raw.trim();
  if (text.length > 160) return false;
  // A named list or a nonempty colon/comma-separated detail is user input.
  if (/[,;:\n]/.test(text) && text.split(/[,;:\n]/).slice(1).some(part => part.trim())) return false;
  if (/(?:^|\s)\d{1,2}[.)]\s+/.test(text)) return false;
  const genericWords = new Set([
    "aaj", "kal", "today", "tomorrow", "tomorrows", "todays", "today's", "tomorrow's",
    "my", "me", "mujhe", "mere", "mera", "meri", "hamare", "hamara", "hamari",
    "ke", "ka", "ki", "ko", "mein", "se", "liye", "kar", "karo", "do", "please",
    "3", "three", "teen", "top", "important", "key", "main", "zaroori", "jaruri", "kuch",
    "task", "tasks", "kaam", "work", "jobs", "job", "todo", "to", "priorities", "priority",
    "plan", "planning", "schedule", "routine", "day", "week", "daily", "din",
    "banao", "batao", "btao", "suggest", "create", "make", "give", "tell", "list", "organize",
    "for", "the", "a", "an", "of", "and", "is",
    "आज", "कल", "के", "का", "की", "मुझे", "मेरे", "मेरा", "मेरी",
    "तीन", "महत्वपूर्ण", "जरूरी", "ज़रूरी", "काम", "कार्य", "दिन", "योजना",
    "प्लान", "बनाओ", "बताओ", "सूची", "दो"
  ]);
  const words = text.toLocaleLowerCase().replace(/[’']/g, "").match(/[\p{L}\p{M}\p{N}]+/gu) || [];
  if (words.some(word => !genericWords.has(word) && !/^\d+$/.test(word))) return false;
  return /\b(?:plan|planning|schedule|routine|day|week|aaj|kal|today|tomorrow|kaam|tasks?|work|priorities|todo)\b|(?:आज|कल|काम|कार्य|योजना|प्लान|बनाओ|बताओ)/i.test(text);
}


/**
 * Deterministic, offline-safe outline used only after the authenticated AI
 * planning route reports a malformed/unusable plan (TASK_PLAN_FAILED).
 * Reuses user-provided task labels verbatim: never adds meetings, people,
 * times or deadlines, and never performs an external action.
 */
export function createLocalTaskOutline(raw) {
  if (needsTaskDetails(raw)) throw new TypeError("Enter real task details before planning.");
  const text = raw.trim().slice(0, 4000);
  const numbers = text.match(/(?:^|\s)\d{1,2}[.)]\s+/g) || [];
  let parts;
  if (numbers.length > 1) {
    parts = text.split(/(?:^|\s)\d{1,2}[.)]\s+/);
  } else if (text.includes("\n")) {
    parts = text.split(/\n+/);
  } else if (text.includes(";")) {
    parts = text.split(";");
  } else {
    parts = [text];
  }
  const items = parts
    .map(value => value.replace(/^\s*(?:[-•*]|\d{1,2}[.)])\s*/, "").trim())
    .filter(Boolean);
  if (!items.length) throw new TypeError("No actual tasks supplied.");
  const steps = items.slice(0, 8).map(value => value.slice(0, 240));
  return {
    summary: items.length > 8
      ? "Local checklist from the first 8 tasks you provided. AI planning unavailable."
      : "Local checklist from the " + items.length + " task" + (items.length === 1 ? "" : "s") + " you provided. AI planning unavailable.",
    steps,
    actionType: "none",
    requiresApproval: false,
    source: "local"
  };
}

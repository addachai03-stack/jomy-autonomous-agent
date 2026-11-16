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
 * A personal schedule request is not evidence that the user has those tasks.
 * Detect only high-confidence generic requests; named or enumerated tasks
 * should still be planned normally. Never infer specific commitments.
 */
export function needsSpecificTasks(input) {
  if (typeof input !== "string") return false;
  const text = input.trim().toLocaleLowerCase().replace(/\s+/g, " ");
  if (!text || /[:;\n]/.test(input)) return false;
  const endings = "[?.!।]*$";
  const patterns = [
    /^(?:mujhe\s+)?(?:kal|aaj)(?:\s+(?:ke|ka|ki))?\s*(?:(?:top|mere|meri)\s+)?(?:(?:\d+|teen|three)\s+)?(?:(?:important|zaroori|zaruri|jaruri)\s+)?(?:kaam|tasks?|priorities|to-?dos?)\s*(?:(?:ka|ki|ke)\s+)?(?:(?:plan|schedule|planning)\s+)?(?:banao|batao|banado|bnao|suggest\s+karo)?[?.!]*$/i,
    /^(?:kal|aaj)(?:\s+ka)?\s+(?:plan|schedule|routine)\s+(?:banao|batao|banado|bnao)[?.!]*$/i,
    /^plan\s+(?:my|our)\s+(?:(?:today'?s|tomorrow'?s|daily)\s+)?(?:(?:\d+|three|top)\s+)?(?:(?:important|key)\s+)?(?:tasks?|day|work|priorities)(?:\s+for\s+(?:today|tomorrow))?[?.!]*$/i,
    /^(?:आज|कल|मेरे|मेरी)(?:\s+के|\s+का|\s+की)?\s*(?:(?:[0-9०-९]+|तीन)\s+)?(?:(?:ज़रूरी|जरूरी|महत्वपूर्ण)\s+)?(?:काम|कार्य|टास्क)(?:\s+का|\s+की|\s+के)?\s*(?:प्लान|योजना)?\s*(?:बनाओ|बताओ|बनाइए|बनाएं)?[?.!।]*$/,
    /^(?:आज|कल)(?:\s+का)?\s+(?:प्लान|शेड्यूल|दिनचर्या)\s+(?:बनाओ|बताओ|बनाइए|बनाएं)[?.!।]*$/
  ];
  return patterns.some(pattern => pattern.test(text));
}

export function buildGroundedTaskRequest(title, userTaskDetails = "") {
  const request = typeof title === "string" ? title.trim() : "";
  const details = typeof userTaskDetails === "string" ? userTaskDetails.trim().slice(0, 600) : "";
  if (!request) throw new TypeError("Task title is required.");
  return [
    "Create a plan only from the actual tasks supplied below.",
    "Do not invent named projects, meetings, people, appointments or fixed deadlines.",
    "If the user did not provide times, do not assume any confirmed times.",
    "Treat proposed steps as suggestions, not already scheduled actions.",
    "Request: " + request,
    ...(details ? ["User-provided actual tasks:", details] : [])
  ].join("\n");
}

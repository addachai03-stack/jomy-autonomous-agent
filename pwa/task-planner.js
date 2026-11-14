const ACTION_TYPES = new Set(["none", "mcp.status", "telegram.prepare", "unsupported"]);

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
  const explicitTelegramSend = typeof taskTitle === "string" &&
    /^(?:telegram|टेलीग्राम)\s+(?:par|pe|पर|पे)\s+(?:message\s+)?(?:bhejo|bhej\s+do|send\s+karo|भेजो|भेज\s+दो|संदेश\s+भेजो)\s*[:,-]?\s*[\s\S]+$/i.test(taskTitle.trim()) ||
    (typeof taskTitle === "string" && /^(?:send|bhejo)\s+(?:this\s+)?on\s+telegram\s*[:,-]?\s*[\s\S]+$/i.test(taskTitle.trim()));
  if (actionType === "telegram.prepare" && !explicitTelegramSend) actionType = "unsupported";
  if (actionType === "mcp.status" && !/mcp\s*(status|स्थिति)|status\s*(of\s*)?mcp/i.test(taskTitle || "")) actionType = "unsupported";
  return {
    summary,
    steps: value.steps.map(step => step.trim()),
    actionType,
    requiresApproval: actionType === "telegram.prepare" || actionType === "unsupported"
  };
}

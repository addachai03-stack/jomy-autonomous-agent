export const TASK_STATES = Object.freeze({
  QUEUED: "queued",
  PLANNING: "planning",
  AWAITING_APPROVAL: "awaiting_approval",
  READY: "ready",
  RUNNING: "running",
  RETRY_WAIT: "retry_wait",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  BLOCKED: "blocked"
});

const TRANSITIONS = Object.freeze({
  queued: ["planning", "blocked"],
  planning: ["awaiting_approval", "ready", "blocked", "failed"],
  awaiting_approval: ["ready", "blocked"],
  ready: ["running", "blocked"],
  running: ["succeeded", "retry_wait", "failed", "awaiting_approval", "blocked"],
  retry_wait: ["queued", "blocked"],
  succeeded: [],
  failed: ["queued"],
  blocked: ["queued"]
});

const MAX_TASK_TITLE = 240;
const MAX_TASKS = 30;
const MAX_ATTEMPTS = 2;

function timestamp(value) {
  return new Date(value).toISOString();
}

export function createTask(input, now = Date.now()) {
  const title = typeof input === "string" ? input.trim() : "";
  if (!title || title.length > 4000) throw new TypeError("Task must contain 1–4000 characters.");
  return {
    id: globalThis.crypto?.randomUUID?.() || "task-" + now + "-" + Math.random().toString(36).slice(2, 10),
    title: title.slice(0, MAX_TASK_TITLE),
    status: TASK_STATES.QUEUED,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    steps: [],
    lastError: null,
    createdAt: timestamp(now),
    updatedAt: timestamp(now)
  };
}

export function addTask(queue, task) {
  if (!Array.isArray(queue)) throw new TypeError("Task queue must be an array.");
  if (queue.some(item => item?.id === task?.id)) return queue.slice();
  return [...queue, task].slice(-MAX_TASKS);
}

export function transitionTask(task, nextState, details = {}, now = Date.now()) {
  if (!task || !Object.hasOwn(TRANSITIONS, task.status)) throw new TypeError("Invalid task.");
  if (!TRANSITIONS[task.status].includes(nextState)) {
    throw new Error("Invalid task transition: " + task.status + " → " + nextState);
  }
  const updated = { ...task, status: nextState, updatedAt: timestamp(now) };
  if (nextState === TASK_STATES.RUNNING) updated.attempts = task.attempts + 1;
  if (details.steps !== undefined) {
    if (!Array.isArray(details.steps) || details.steps.length > 12 ||
        details.steps.some(step => typeof step !== "string" || !step.trim() || step.length > 240)) {
      throw new TypeError("Task steps must be up to 12 short text items.");
    }
    updated.steps = details.steps.map(step => step.trim());
  }
  if (details.error !== undefined) {
    updated.lastError = typeof details.error === "string" ? details.error.slice(0, 300) : "Task failed.";
  }
  if (nextState === TASK_STATES.SUCCEEDED) updated.lastError = null;
  return updated;
}

export function recoverInterruptedTasks(queue, now = Date.now()) {
  if (!Array.isArray(queue)) return [];
  return queue.map(task => {
    if (!task || ![TASK_STATES.PLANNING, TASK_STATES.RUNNING, TASK_STATES.RETRY_WAIT].includes(task.status)) return task;
    const reason = task.status === TASK_STATES.PLANNING
      ? "App closed or refreshed while planning. Review and retry the plan."
      : task.status === TASK_STATES.RUNNING
        ? "App closed or refreshed during a task. No completion was confirmed; review before retrying."
        : "A scheduled retry was interrupted by an app restart. Review and retry when ready.";
    return {
      ...task,
      status: TASK_STATES.FAILED,
      lastError: reason,
      updatedAt: timestamp(now)
    };
  });
}

export function retryTask(task, now = Date.now()) {
  if (!task || ![TASK_STATES.FAILED, TASK_STATES.RETRY_WAIT].includes(task.status)) {
    throw new Error("Only failed or retry-wait tasks can be retried.");
  }
  if (task.attempts >= task.maxAttempts) {
    return { ...task, status: TASK_STATES.FAILED, lastError: task.lastError || "Retry limit reached.", updatedAt: timestamp(now) };
  }
  return transitionTask(task, TASK_STATES.QUEUED, {}, now);
}

const APPROVAL_REQUIRED = new Set([
  "telegram.prepare",
  "external.write",
  "financial.transfer",
  "account.security",
  "data.delete",
  "app.publish"
]);

export function actionPolicy(actionType) {
  if (actionType === "mcp.status") return { classification: "read_only", approvalRequired: false, executable: false };
  if (APPROVAL_REQUIRED.has(actionType)) return { classification: "sensitive", approvalRequired: true, executable: false };
  return { classification: "unsupported", approvalRequired: true, executable: false };
}

export function createActionProposal(actionType, payload = {}) {
  const policy = actionPolicy(actionType);
  return {
    id: globalThis.crypto?.randomUUID?.() || "proposal-" + Date.now(),
    type: actionType,
    payload,
    status: policy.approvalRequired ? "awaiting_owner_approval" : "proposed",
    policy,
    executed: false
  };
}

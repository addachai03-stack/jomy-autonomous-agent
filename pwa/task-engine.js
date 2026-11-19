export const TASK_STATES = Object.freeze({
  QUEUED: "queued",
  NEEDS_DETAILS: "needs_details",
  PLANNING: "planning",
  AWAITING_APPROVAL: "awaiting_approval",
  READY: "ready",
  IN_PROGRESS: "in_progress",
  DONE: "done",
  RUNNING: "running",
  RETRY_WAIT: "retry_wait",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  BLOCKED: "blocked"
});

const TRANSITIONS = Object.freeze({
  queued: ["planning", "needs_details", "blocked"],
  needs_details: ["queued"],
  planning: ["awaiting_approval", "ready", "blocked", "failed"],
  awaiting_approval: ["ready", "blocked"],
  ready: ["in_progress", "done", "running", "blocked"],
  in_progress: ["ready", "done"],
  done: ["ready"],
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
  // A previous failed attempt is no longer an active error once the task
  // has been retried, planned successfully, or confirmed as succeeded.
  if ([TASK_STATES.QUEUED, TASK_STATES.READY, TASK_STATES.DONE, TASK_STATES.SUCCEEDED].includes(nextState)) {
    updated.lastError = null;
  }
  if (nextState === TASK_STATES.RUNNING) updated.attempts = task.attempts + 1;
  // These user-marked states never launch or imply an external action.
  if (nextState === TASK_STATES.IN_PROGRESS) updated.manualStartedAt = timestamp(now);
  if (nextState === TASK_STATES.DONE) updated.manualCompletedAt = timestamp(now);
  if (nextState === TASK_STATES.READY && [TASK_STATES.IN_PROGRESS, TASK_STATES.DONE].includes(task.status)) {
    delete updated.manualStartedAt;
    delete updated.manualCompletedAt;
  }
  if (details.steps !== undefined) {
    if (!Array.isArray(details.steps) || details.steps.length > 12 ||
        details.steps.some(step => typeof step !== "string" || !step.trim() || step.length > 240)) {
      throw new TypeError("Task steps must be up to 12 short text items.");
    }
    updated.steps = details.steps.map(step => step.trim());
    // A newly generated/replaced plan must not inherit checkmarks by index.
    updated.completedStepIndices = [];
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


/**
 * Locally checked steps use their array positions so even duplicate step
 * descriptions can be checked separately. Ignore malformed legacy entries.
 */
export function getChecklistProgress(task) {
  const steps = Array.isArray(task?.steps) ? task.steps.slice(0, 12) : [];
  const checked = Array.isArray(task?.completedStepIndices) ? task.completedStepIndices : [];
  const indices = [...new Set(checked.filter(index =>
    Number.isInteger(index) && index >= 0 && index < steps.length
  ))].sort((a, b) => a - b);
  return { done: indices.length, total: steps.length, indices };
}

/**
 * Owner-driven checklist edit, not a task status transition or execution.
 * Marking every step does NOT mark the entire task as DONE.
 */
export function setChecklistStepChecked(task, stepIndex, checked, now = Date.now()) {
  if (!task || ![TASK_STATES.READY, TASK_STATES.IN_PROGRESS, TASK_STATES.DONE].includes(task.status)) {
    throw new Error("Only manually managed planned tasks can change checklists.");
  }
  const { total, indices } = getChecklistProgress(task);
  if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= total || typeof checked !== "boolean") {
    throw new TypeError("Invalid checklist step or checked value.");
  }
  const next = new Set(indices);
  if (checked) next.add(stepIndex);
  else next.delete(stepIndex);
  return {
    ...task,
    completedStepIndices: [...next].sort((a, b) => a - b),
    updatedAt: timestamp(now)
  };
}


/**
 * Non-destructive dashboard grouping for existing on-device tasks.
 * Pending means unresolved / needs attention: queued, planning, ready,
 * awaiting details or approval, retries, failed and blocked.
 * Legacy RUNNING/SUCCEEDED count as active/finished respectively.
 */
export function taskDashboardCategory(status) {
  if (status === TASK_STATES.IN_PROGRESS || status === TASK_STATES.RUNNING) return "in_progress";
  if (status === TASK_STATES.DONE || status === TASK_STATES.SUCCEEDED) return "done";
  return "pending";
}

export function summarizeTaskQueue(queue) {
  const counts = { all: 0, pending: 0, in_progress: 0, done: 0 };
  if (!Array.isArray(queue)) return counts;
  for (const task of queue) {
    if (!task || typeof task.status !== "string") continue;
    counts.all++;
    counts[taskDashboardCategory(task.status)]++;
  }
  return counts;
}

export function filterTaskQueue(queue, filter = "all") {
  if (!Array.isArray(queue)) return [];
  const tasks = queue.filter(task => task && typeof task.status === "string");
  if (!["pending", "in_progress", "done"].includes(filter)) return tasks;
  return tasks.filter(task => taskDashboardCategory(task.status) === filter);
}


/**
 * Read-only search and ordering of the existing device-local task list.
 * Match task names and owner-provided details (plus plan summary), case-insensitively.
 * Sorting by creation date does not modify any stored task or its checklist.
 */
export function searchAndSortTaskQueue(queue, query = "", sort = "newest") {
  if (!Array.isArray(queue)) return [];
  const needle = typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
  const matches = queue.filter(task => {
    if (!task || typeof task.title !== "string") return false;
    if (!needle) return true;
    const annotation = getTaskAnnotations(task);
    const terms = [task.title, task.details, task.plan?.summary, annotation.note, ...annotation.tags];
    return terms.some(value => typeof value === "string" && value.toLocaleLowerCase().includes(needle));
  });
  if (!["newest", "oldest", "priority"].includes(sort)) return matches;
  const dateOf = task => {
    const parsed = Date.parse(task.createdAt || task.updatedAt || "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const priorityRanks = { high: 3, medium: 2, low: 1, none: 0 };
  return matches.map((task, index) => ({
    task, index, date: dateOf(task),
    rank: priorityRanks[getTaskSchedule(task).priority]
  })).sort((a, b) => (
    sort === "priority" ? (b.rank - a.rank || b.date - a.date) :
    sort === "newest" ? b.date - a.date : a.date - b.date
  ) || a.index - b.index).map(item => item.task);
}


/** Optional owner-only metadata on existing saved tasks; no reminders or execution. */
const TASK_PRIORITIES = new Set(["none", "low", "medium", "high"]);
function validTaskDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function getTaskSchedule(task) {
  return {
    priority: TASK_PRIORITIES.has(task?.priority) ? task.priority : "none",
    dueDate: validTaskDate(task?.dueDate) ? task.dueDate : ""
  };
}

/** Keep status, plan, checklist, and existing other metadata untouched. */
export function setTaskSchedule(task, changes, now = Date.now()) {
  if (!task || typeof task.id !== "string" || !changes || typeof changes !== "object") {
    throw new TypeError("Invalid task schedule update.");
  }
  const result = { ...getTaskSchedule(task) };
  if (Object.hasOwn(changes, "priority")) {
    if (typeof changes.priority !== "string" || !TASK_PRIORITIES.has(changes.priority)) {
      throw new TypeError("Priority must be none, low, medium or high.");
    }
    result.priority = changes.priority;
  }
  if (Object.hasOwn(changes, "dueDate")) {
    if (typeof changes.dueDate !== "string" || (changes.dueDate !== "" && !validTaskDate(changes.dueDate))) {
      throw new TypeError("Due date must be an existing calendar date in YYYY-MM-DD format or empty.");
    }
    result.dueDate = changes.dueDate;
  }
  return { ...task, ...result, updatedAt: timestamp(now) };
}

/**
 * Deadline views use the device's calendar date, not UTC, so iPhone-local
 * midnight changes the view at the right local time. This is not a reminder.
 */
export function localCalendarDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid current date.");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

export function taskDueState(task, today = localCalendarDate()) {
  const dueDate = getTaskSchedule(task).dueDate;
  if (!dueDate || task?.status === TASK_STATES.DONE || task?.status === TASK_STATES.SUCCEEDED) return "none";
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "upcoming";
}

export function summarizeTaskDeadlines(queue, today = localCalendarDate()) {
  const result = { today: 0, overdue: 0 };
  if (!Array.isArray(queue)) return result;
  for (const task of queue) {
    if (!task || typeof task.status !== "string") continue;
    const state = taskDueState(task, today);
    if (state === "today" || state === "overdue") result[state]++;
  }
  return result;
}

export function filterTaskDeadlines(queue, filter = "all", today = localCalendarDate()) {
  if (!Array.isArray(queue)) return [];
  if (filter !== "today" && filter !== "overdue") return queue.slice();
  return queue.filter(task => task && taskDueState(task, today) === filter);
}


/**
 * Task Queue 2.7: explicit, device-only JSON backup. Only known task fields
 * are exported/imported; Agent tokens, settings and Personal Memory are NEVER
 * included. Import is merge-only, not an automatic replacement of local data.
 */
const TASK_BACKUP_FORMAT = "jomy-task-queue-backup";
const TASK_BACKUP_VERSION = 1;
const TASK_BACKUP_STATUSES = new Set(Object.values(TASK_STATES));
const UNSAFE_RESUME_STATUSES = new Set([
  TASK_STATES.RUNNING, TASK_STATES.PLANNING,
  TASK_STATES.RETRY_WAIT, TASK_STATES.AWAITING_APPROVAL
]);

function backupDate(value, fallback) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function safeBackupTask(task) {
  if (!task || typeof task !== "object" || Array.isArray(task) ||
      typeof task.id !== "string" || !task.id.trim() || task.id.length > 128 ||
      typeof task.title !== "string" || !task.title.trim() || task.title.length > 240 ||
      !TASK_BACKUP_STATUSES.has(task.status)) {
    throw new TypeError("Backup contains an invalid task identity, title or status.");
  }
  if (task.steps !== undefined && (
    !Array.isArray(task.steps) || task.steps.length > 12 ||
    task.steps.some(step => typeof step !== "string" || !step.trim() || step.length > 240)
  )) throw new TypeError("Backup contains invalid checklist steps.");
  if (task.details !== undefined && (typeof task.details !== "string" || task.details.length > 4000)) {
    throw new TypeError("Backup contains invalid task details.");
  }
  const steps = Array.isArray(task.steps) ? task.steps.slice() : [];
  const { priority, dueDate } = getTaskSchedule(task);
  const fallback = "1970-01-01T00:00:00.000Z";
  const createdAt = backupDate(task.createdAt, fallback);
  const updatedAt = backupDate(task.updatedAt, createdAt);
  const importedStatus = UNSAFE_RESUME_STATUSES.has(task.status) ? TASK_STATES.FAILED : task.status;
  const record = {
    id: task.id,
    title: task.title,
    status: importedStatus,
    attempts: Number.isInteger(task.attempts) ? Math.max(0, Math.min(task.attempts, 2)) : 0,
    maxAttempts: 2,
    steps,
    completedStepIndices: getChecklistProgress({steps,completedStepIndices:task.completedStepIndices}).indices,
    createdAt,
    updatedAt,
    priority,
    dueDate,
    lastError: importedStatus === TASK_STATES.FAILED && importedStatus !== task.status
      ? "Imported unfinished task. Review and retry manually."
      : typeof task.lastError === "string" ? task.lastError.slice(0, 500) : null
  };
  if (typeof task.details === "string") record.details = task.details;
  if (task.note !== undefined && (typeof task.note !== "string" ||
    task.note.length > 1000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(task.note))) {
    throw new TypeError("Backup contains invalid task note.");
  }
  if (task.tags !== undefined) validatedTaskTags(task.tags);
  const annotation = getTaskAnnotations(task);
  record.note = annotation.note;
  record.tags = annotation.tags;
  if (task.plan && typeof task.plan === "object" &&
      typeof task.plan.summary === "string" && task.plan.summary.length <= 2000) {
    record.plan = {
      summary: task.plan.summary,
      source: typeof task.plan.source === "string" ? task.plan.source.slice(0, 40) : "backup"
    };
  }
  for (const key of ["manualStartedAt", "manualCompletedAt"]) {
    const date = backupDate(task[key], null);
    if (date) record[key] = date;
  }
  return record;
}

export function createTaskQueueBackup(queue, now = new Date()) {
  if (!Array.isArray(queue) || queue.length > MAX_TASKS) {
    throw new TypeError("Task backup requires up to 30 saved tasks.");
  }
  const timestampValue = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(timestampValue.getTime())) throw new TypeError("Invalid backup timestamp.");
  const ids = new Set();
  const tasks = queue.map(task => {
    const record = safeBackupTask(task);
    if (ids.has(record.id)) throw new TypeError("Task backup contains duplicate IDs.");
    ids.add(record.id);
    return record;
  });
  return JSON.stringify({
    format: TASK_BACKUP_FORMAT,
    version: TASK_BACKUP_VERSION,
    exportedAt: timestampValue.toISOString(),
    tasks
  }, null, 2);
}

export function readTaskQueueBackup(text) {
  if (typeof text !== "string" || text.length > 524288) {
    throw new TypeError("Backup file is too large or not text.");
  }
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new TypeError("File is not valid JSON."); }
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      data.format !== TASK_BACKUP_FORMAT || data.version !== TASK_BACKUP_VERSION ||
      !Array.isArray(data.tasks) || data.tasks.length > MAX_TASKS) {
    throw new TypeError("Not a supported JOMY Task Queue backup (v1, max 30 tasks).");
  }
  const ids = new Set();
  return data.tasks.map(task => {
    const record = safeBackupTask(task);
    if (ids.has(record.id)) throw new TypeError("Backup file has duplicate task IDs.");
    ids.add(record.id);
    return record;
  });
}

export function mergeTaskQueueBackup(existing, incoming) {
  if (!Array.isArray(existing) || !Array.isArray(incoming) ||
      existing.length > MAX_TASKS || incoming.length > MAX_TASKS) {
    throw new TypeError("Invalid task queue backup merge.");
  }
  const ids = new Set(existing.map(task => task?.id).filter(id => typeof id === "string"));
  const queue = existing.slice();
  let imported = 0;
  let duplicates = 0;
  let full = 0;
  for (const item of incoming) {
    const task = safeBackupTask(item);
    if (ids.has(task.id)) { duplicates++; continue; }
    ids.add(task.id);
    if (queue.length >= MAX_TASKS) { full++; continue; }
    queue.push(task);
    imported++;
  }
  return { queue, imported, duplicates, full };
}


/** Owner-only, device-local task annotations, never included in AI planning calls. */
const MAX_TASK_NOTE = 1000;
const MAX_TASK_TAGS = 5;
const MAX_TASK_TAG_LENGTH = 24;

function validatedTaskTags(input) {
  const items = typeof input === "string" ? (input.trim() ? input.split(",") : []) : input;
  if (!Array.isArray(items)) throw new TypeError("Tags must be comma-separated text or a list.");
  if (items.length > MAX_TASK_TAGS) throw new TypeError("Use at most 5 tags.");
  const tags = [];
  const seen = new Set();
  for (const value of items) {
    if (typeof value !== "string") throw new TypeError("Tags must be text.");
    const tag = value.trim();
    if (!tag || tag.length > MAX_TASK_TAG_LENGTH || /[,\x00-\x1f\x7f]/.test(tag)) {
      throw new TypeError("Each tag must contain 1–24 characters, no commas or control characters.");
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

export function getTaskAnnotations(task) {
  const note = typeof task?.note === "string" && task.note.length <= MAX_TASK_NOTE ? task.note : "";
  let tags = [];
  try { tags = validatedTaskTags(task?.tags ?? []); } catch (_) {}
  return { note, tags };
}

/** Atomic edit: invalid input never changes an existing task or its checklist. */
export function setTaskAnnotations(task, changes, now = Date.now()) {
  if (!task || typeof task.id !== "string" || !changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new TypeError("Invalid task annotation update.");
  }
  const current = getTaskAnnotations(task);
  const note = Object.hasOwn(changes, "note") ? changes.note : current.note;
  if (typeof note !== "string" || note.length > MAX_TASK_NOTE || /[\x00-\x08\x0b-\x1f\x7f]/.test(note)) {
    throw new TypeError("Task note must be text up to 1000 characters.");
  }
  const tags = Object.hasOwn(changes, "tags") ? validatedTaskTags(changes.tags) : current.tags;
  return { ...task, note, tags, updatedAt: timestamp(now) };
}


/**
 * Task Queue 2.9: reusable, owner-created templates in separate device storage.
 * Deliberately exclude notes, private details, due dates, checkmarks, plans,
 * API actions and credentials. Using a template never starts a Worker request.
 */
export const MAX_TASK_TEMPLATES = 10;

function normalizedTaskTemplate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.id !== "string" || !value.id.trim() || value.id.length > 128 ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 240 ||
      !Array.isArray(value.steps) || value.steps.length > 12 ||
      value.steps.some(step => typeof step !== "string" || !step.trim() || step.length > 240)) {
    throw new TypeError("Invalid reusable task template.");
  }
  const priority = ["none", "low", "medium", "high"].includes(value.priority) ? value.priority : "none";
  let tags = [];
  try { tags = validatedTaskTags(value.tags ?? []); } catch (_) {
    throw new TypeError("Invalid reusable task template tags.");
  }
  return { id: value.id, title: value.title.trim(), steps: value.steps.map(step => step.trim()), priority, tags };
}

export function createTaskTemplate(task, now = Date.now()) {
  if (!task || typeof task.title !== "string" || !task.title.trim() ||
      task.title.trim().length > 240) throw new TypeError("Cannot make a template from this task.");
  const steps = Array.isArray(task.steps) ? task.steps : [];
  if (steps.length > 12 || steps.some(step => typeof step !== "string" || !step.trim() || step.length > 240)) {
    throw new TypeError("Task steps cannot become a template.");
  }
  const timestampValue = new Date(now).toISOString();
  return normalizedTaskTemplate({
    id: globalThis.crypto?.randomUUID?.() || "template-" + String(now) + "-" + Math.random().toString(36).slice(2, 9),
    title: task.title.trim(),
    steps: steps.slice(),
    priority: getTaskSchedule(task).priority,
    tags: getTaskAnnotations(task).tags,
    createdAt: timestampValue
  });
}

export function readTaskTemplates(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const ids = new Set();
  const titles = new Set();
  for (const item of value.slice(0, MAX_TASK_TEMPLATES)) {
    try {
      const template = normalizedTaskTemplate(item);
      const titleKey = template.title.toLocaleLowerCase();
      if (ids.has(template.id) || titles.has(titleKey)) continue;
      ids.add(template.id);
      titles.add(titleKey);
      result.push(template);
    } catch (_) {}
  }
  return result;
}

export function addTaskTemplate(templates, template) {
  if (!Array.isArray(templates) || templates.length > MAX_TASK_TEMPLATES) {
    throw new TypeError("Invalid saved template collection.");
  }
  const next = normalizedTaskTemplate(template);
  if (templates.length >= MAX_TASK_TEMPLATES) throw new Error("Template limit reached (10).");
  if (templates.some(item => item?.id === next.id ||
      (typeof item?.title === "string" && item.title.toLocaleLowerCase() === next.title.toLocaleLowerCase()))) {
    throw new Error("A template with this name already exists.");
  }
  return [...templates, next];
}

export function createTaskFromTemplate(template, now = Date.now()) {
  const saved = normalizedTaskTemplate(template);
  const task = createTask(saved.title, now);
  return {
    ...task,
    status: TASK_STATES.READY,
    steps: saved.steps.slice(),
    completedStepIndices: [],
    priority: saved.priority,
    tags: saved.tags.slice(),
    dueDate: "",
    note: "",
    plan: {
      source: "local",
      summary: "Reusable template · manual checklist only. No external action has been executed."
    }
  };
}


/**
 * JOMY 3.0: read-only analytics from tasks currently saved on this device.
 * No tracking requests, telemetry, historical log or claim of task execution.
 * A completion contributes to the daily chart ONLY if the task is currently
 * manually DONE with a valid manualCompletedAt timestamp. Legacy SUCCEEDED
 * tasks are counted as currently done but not assigned to invented dates.
 */
export function summarizeTaskAnalytics(queue, now = new Date()) {
  const end = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(end.getTime())) throw new TypeError("Invalid analytics date.");
  const source = Array.isArray(queue) ? queue : [];
  const counts = summarizeTaskQueue(source);
  const rate = counts.all ? Math.round(counts.done / counts.all * 100) : 0;
  const days = [];
  const indices = new Map();
  for (let back = 6; back >= 0; back--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - back, 12);
    const day = localCalendarDate(d);
    indices.set(day, days.length);
    days.push({
      day,
      label: d.toLocaleDateString("en-IN", { weekday: "short" }),
      created: 0,
      completed: 0
    });
  }
  let undatedCompleted = 0;
  for (const task of source) {
    if (!task || typeof task.status !== "string") continue;
    const dateKey = value => {
      if (typeof value !== "string" || !value.trim()) return "";
      const date = new Date(value);
      return Number.isFinite(date.getTime()) ? localCalendarDate(date) : "";
    };
    const created = dateKey(task.createdAt);
    if (indices.has(created)) days[indices.get(created)].created++;
    if (task.status === TASK_STATES.DONE) {
      const completed = dateKey(task.manualCompletedAt);
      if (indices.has(completed)) days[indices.get(completed)].completed++;
      else if (!completed) undatedCompleted++;
    } else if (task.status === TASK_STATES.SUCCEEDED) {
      // Legacy successful tasks may lack a trusted completion date.
      undatedCompleted++;
    }
  }
  return {
    total: counts.all,
    pending: counts.pending,
    inProgress: counts.in_progress,
    done: counts.done,
    completionRate: rate,
    todayCreated: days[6].created,
    todayCompleted: days[6].completed,
    last7Created: days.reduce((sum, day) => sum + day.created, 0),
    last7Completed: days.reduce((sum, day) => sum + day.completed, 0),
    undatedCompleted,
    days
  };
}

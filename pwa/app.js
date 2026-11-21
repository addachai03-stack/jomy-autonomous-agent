import { parseWakeCommand, discardPendingVoiceCapture, normalizeAgentEndpoint } from "./voice-utils.js";
import { prepareSpeechText } from "./speech-text.js";
import { selectHindiFemaleVoice } from "./speech-voice.js";
import { addMemory, removeMemory, extractMemoryFromMessage, formatMemoryContext } from "./memory-utils.js";
import { createTask, createManualTask, addTask, persistTaskQueueSafely, restoreDeletedTask, transitionTask, retryTask, recoverInterruptedTasks, getChecklistProgress, setChecklistStepChecked, summarizeTaskQueue, filterTaskQueue, searchAndSortTaskQueue, getTaskSchedule, setTaskSchedule, localCalendarDate, taskDueState, summarizeTaskDeadlines, filterTaskDeadlines, createTaskQueueBackup, readTaskQueueBackup, mergeTaskQueueBackup, getTaskAnnotations, setTaskAnnotations, MAX_TASK_TEMPLATES, createTaskTemplate, readTaskTemplates, addTaskTemplate, createTaskFromTemplate, summarizeTaskAnalytics, summarizeTaskActivityReport, createTaskActivityCsv, validateWeeklyTaskGoal, summarizeWeeklyTaskGoal, summarizeUpcomingCalendar, summarizeDailyFocusPlan, summarizeDailyTaskProgress, TASK_STATES } from "./task-engine.js";
import { parseTaskPlan, needsTaskDetails, createLocalTaskOutline } from "./task-planner.js";

(() => {
  const $ = (id) => document.getElementById(id);
  const orbStage = $("orbStage");
  const statusText = $("statusText");
  const orbCaption = $("orbCaption");
  const micButton = $("micButton");
  const micLabel = $("micLabel");
  const soundButton = $("soundButton");
  const handsFreeButton = $("handsFreeButton");
  const messageInput = $("messageInput");
  const chatForm = $("chatForm");
  const messages = $("messages");
  const emptyState = $("emptyState");
  const activityCount = $("activityCount");
  const activityToggle = $("activityToggle");
  const activityBoard = document.querySelector(".activity");
  const taskPanel = $("taskPanel");
  const taskForm = $("taskForm");
  const taskAddStatus = $("taskAddStatus");
  const taskStorageStatus = $("taskStorageStatus");
  const taskDeleteRecovery = $("taskDeleteRecovery");
  const taskUndoDelete = $("taskUndoDelete");
  const taskUndoSummary = $("taskUndoSummary");
  let pendingDeletedTask = null;
  const taskInput = $("taskInput");
  const taskSearchInput = $("taskSearchInput");
  const taskSortSelect = $("taskSortSelect");
  const taskList = $("taskList");
  const taskTemplateList = $("taskTemplateList");
  const taskTemplateCount = $("taskTemplateCount");
  const taskTemplateStatus = $("taskTemplateStatus");
  const taskTemplatesPanel = $("taskTemplatesPanel");
  const taskBackupExport = $("taskBackupExport");
  const taskBackupFile = $("taskBackupFile");
  const taskBackupImport = $("taskBackupImport");
  const taskBackupStatus = $("taskBackupStatus");
  const taskBackupPanel = $("taskBackupPanel");
  const taskTransferPanel = $("taskTransferPanel");
  const taskTransferChoose = $("taskTransferChoose");
  let pendingBackupTasks = null;
  const memoryForm = $("memoryForm");
  const memoryInput = $("memoryInput");
  const memoryList = $("memoryList");
  const taskCount = $("taskCount");
  const taskDashboard = $("taskDashboard");
  const taskFilterSummary = $("taskFilterSummary");
  const taskFocusSummary = $("taskFocusSummary");
  const taskFocusProgress = $("taskFocusProgress");
  const taskFocusProgressFill = $("taskFocusProgressFill");
  const taskFocusProgressLabel = $("taskFocusProgressLabel");
  const taskFocusList = $("taskFocusList");
  const taskFocusClear = $("taskFocusClear");
  let activeFocusTaskId = "";
  const calendarSummary = $("calendarSummary");
  const calendarDays = $("calendarDays");
  const calendarClear = $("calendarClear");
  let activeCalendarDay = "";
  const insightsDone = $("insightsDone");
  const insightsRate = $("insightsRate");
  const insightsCreatedToday = $("insightsCreatedToday");
  const insightsDoneToday = $("insightsDoneToday");
  const insightsWeek = $("insightsWeek");
  const insightsBars = $("insightsBars");
  const insightsNote = $("insightsNote");
  const reportRangeSelect = $("reportRangeSelect");
  const reportCreated = $("reportCreated");
  const reportDone = $("reportDone");
  const reportTopDay = $("reportTopDay");
  const reportExport = $("reportExport");
  const reportStatus = $("reportStatus");
  const weeklyGoalForm = $("weeklyGoalForm");
  const weeklyGoalInput = $("weeklyGoalInput");
  const weeklyGoalPeriod = $("weeklyGoalPeriod");
  const weeklyGoalProgress = $("weeklyGoalProgress");
  const weeklyGoalPercentage = $("weeklyGoalPercentage");
  const weeklyGoalBar = $("weeklyGoalBar");
  const weeklyGoalFill = $("weeklyGoalFill");
  const weeklyGoalStatus = $("weeklyGoalStatus");
  const taskDashboardButtons = [...taskDashboard.querySelectorAll("[data-task-filter]")];
  const deadlineViews = $("taskDeadlineViews");
  const deadlineButtons = [...deadlineViews.querySelectorAll("[data-deadline-filter]")];
  let activeTaskFilter = "all";
  let activeDeadlineFilter = "all";
  const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1";
  const TASK_TEMPLATES_KEY = "jomy_agent_task_templates_v1";
  const WEEKLY_GOAL_KEY = "jomy_agent_weekly_goal_v1";
  const MEMORY_KEY = "jomy_agent_personal_memory_v1";
  let weeklyGoalTarget = null;
  try {
    const savedGoal = JSON.parse(localStorage.getItem(WEEKLY_GOAL_KEY) || "null");
    if (savedGoal) weeklyGoalTarget = validateWeeklyTaskGoal(savedGoal.target);
  } catch (_) { weeklyGoalTarget = null; }
  if (weeklyGoalTarget !== null) weeklyGoalInput.value = String(weeklyGoalTarget);
  let taskTemplates = [];
  try {
    taskTemplates = readTaskTemplates(JSON.parse(localStorage.getItem(TASK_TEMPLATES_KEY) || "[]"));
  } catch (_) { taskTemplates = []; }
  let personalMemories = [];
  try {
    const savedMemories = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    if (Array.isArray(savedMemories)) personalMemories = savedMemories.filter(item => item && typeof item.id === "string" && typeof item.fact === "string").slice(-15);
  } catch (_) {}
  let taskQueue = [];
  try {
    const savedTasks = JSON.parse(localStorage.getItem(TASK_QUEUE_KEY) || "[]");
    if (Array.isArray(savedTasks)) taskQueue = savedTasks.filter(task => task && typeof task.id === "string" && typeof task.title === "string" && ["queued", "needs_details", "planning", "awaiting_approval", "ready", "in_progress", "done", "running", "retry_wait", "succeeded", "failed", "blocked"].includes(task.status)).slice(-30);
  } catch (_) {}
  taskQueue = recoverInterruptedTasks(taskQueue).map(task => {
    if (task.plan && ["mcp.status", "telegram.prepare"].includes(task.plan.actionType)) {
      const migrated = {
        ...task,
        status: TASK_STATES.BLOCKED,
        plan: { ...task.plan, actionType: "unsupported", requiresApproval: true },
        lastError: "External integrations are no longer available in JOMY Agent."
      };
      delete migrated.approvalId;
      delete migrated.approvalStatus;
      delete migrated.approvalAction;
      delete migrated.approvalError;
      delete migrated.approvalExpiresAt;
      delete migrated.approvalCheckedAt;
      delete migrated.approvalRefreshing;
      return migrated;
    }
    return task;
  });
  try { localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(taskQueue)); } catch (_) {}
  const settingsDialog = $("settingsDialog");
  const endpointInput = $("endpointInput");
  const agentTokenInput = $("agentTokenInput");
  const connection = $("connection");
  const voiceHint = $("voiceHint");
  const STORAGE_ENDPOINT = "jomy_agent_endpoint_v1";
  const STORAGE_SOUND = "jomy_agent_sound_v1";
  const STORAGE_HANDSFREE = "jomy_agent_handsfree_v1";
  const STORAGE_TOKEN = "jomy_agent_owner_token_v1";
  const DEFAULT_ENDPOINT = "https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat";
  const storedEndpoint = localStorage.getItem(STORAGE_ENDPOINT);
  let endpoint = storedEndpoint === null ? DEFAULT_ENDPOINT : storedEndpoint;
  if (endpoint) {
    try {
      const normalizedEndpoint = normalizeAgentEndpoint(endpoint);
      if (normalizedEndpoint !== endpoint) localStorage.setItem(STORAGE_ENDPOINT, normalizedEndpoint);
      endpoint = normalizedEndpoint;
    } catch (_) {}
  }
  // Persist the owner token across browser restarts on this device.
  // Migrate any token saved by older builds from sessionStorage.
  let ownerToken = localStorage.getItem(STORAGE_TOKEN) || sessionStorage.getItem(STORAGE_TOKEN) || "";
  if (ownerToken) {
    try { localStorage.setItem(STORAGE_TOKEN, ownerToken); } catch (_) {}
  }
  sessionStorage.removeItem(STORAGE_TOKEN);
  sessionStorage.removeItem("jomy_mcp_client_token_v1");
  let soundOn = localStorage.getItem(STORAGE_SOUND) !== "false";
  let recognition = null;
  let listening = false;
  let recognitionBlocked = false;
  let recognitionStarting = false;
  let speakingReply = false;
  let handsFree = localStorage.getItem(STORAGE_HANDSFREE) === "true";
  let waitingForCommand = false;
  let busy = false;
  let voiceSubmissionPending = false;
  let voiceFinalTranscript = "";
  let voiceSendTimer = null;
  let discardVoiceResults = false;
  let count = 0;
  let sessionId = "";
  try { sessionId = sessionStorage.getItem("jomy_agent_session") || ""; } catch (_) {}
  if (!sessionId) {
    sessionId = window.crypto?.randomUUID?.() || String(Date.now());
    try { sessionStorage.setItem("jomy_agent_session", sessionId); } catch (_) {}
  }
  const HISTORY_KEY = "jomy_agent_history_v1";
  let conversationHistory = [];
  try {
    const savedHistory = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    if (Array.isArray(savedHistory)) conversationHistory = savedHistory.filter(item => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-10).map(item => ({ role: item.role, content: item.content.slice(0, 2000) }));
  } catch (_) {}
  function saveConversationHistory() {
    conversationHistory = conversationHistory.slice(-10);
    try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(conversationHistory)); } catch (_) {}
  }

  function saveMemories() {
    personalMemories = personalMemories.slice(-15);
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(personalMemories)); } catch (_) {}
  }
  function renderMemories() {
    memoryList.replaceChildren();
    if (!personalMemories.length) {
      const empty = document.createElement("p");
      empty.className = "memory-empty";
      empty.textContent = "Abhi koi personal fact save nahi hai. Naam ya pasand yahan add kar sakte ho.";
      memoryList.append(empty);
      return;
    }
    for (const item of personalMemories) {
      const row = document.createElement("div");
      row.className = "memory-item";
      const fact = document.createElement("span");
      fact.textContent = item.fact;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "memory-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Delete saved memory");
      remove.addEventListener("click", () => {
        personalMemories = removeMemory(personalMemories, item.id);
        saveMemories();
        renderMemories();
      });
      row.append(fact, remove);
      memoryList.append(row);
    }
  }
  function rememberFact(fact) {
    const next = addMemory(personalMemories, fact);
    if (next.length === personalMemories.length && next.every((item, index) => item.id === personalMemories[index]?.id)) return false;
    personalMemories = next;
    saveMemories();
    renderMemories();
    return true;
  }

  function setState(state, label, detail) {
    orbStage.dataset.state = state;
    orbCaption.textContent = label;
    statusText.textContent = detail;
  }
  function setConnection(online, label) {
    connection.classList.toggle("online", online);
    connection.querySelector("span").textContent = label;
  }
  function addMessage(role, text) {
    conversationHistory.push({ role: role === "user" ? "user" : "assistant", content: String(text).slice(0, 2000) });
    saveConversationHistory();
    if (emptyState) emptyState.remove();
    const node = document.createElement("article");
    node.className = "message " + role;
    const tag = document.createElement("small");
    tag.textContent = role === "user" ? "YOU" : "JOMY";
    const body = document.createElement("div");
    body.textContent = text;
    node.append(tag, body);
    messages.append(node);
    messages.scrollTop = messages.scrollHeight;
    count++;
    activityCount.textContent = count + (count === 1 ? " message" : " messages");
    if (messages.hidden) {
      messages.hidden = false;
      activityToggle.setAttribute("aria-expanded", "true");
      $("activityChevron").textContent = "−";
    }
  }
  function persistTaskQueue(nextQueue) {
    try {
      // Commit first. Never modify the visible queue if Safari storage rejects the write.
      const saved = persistTaskQueueSafely(nextQueue, localStorage, TASK_QUEUE_KEY);
      taskQueue = saved;
      taskStorageStatus.hidden = true;
      taskStorageStatus.textContent = "";
      return true;
    } catch (error) {
      taskStorageStatus.hidden = false;
      taskStorageStatus.textContent = "Changes NOT saved on this iPhone. Your previous tasks are unchanged. Check Safari storage, then retry or EXPORT JSON. "
        + (error?.name === "QuotaExceededError" ? "Storage is full." : "Storage write failed.");
      throw error;
    }
  }
  // One-step, on-page undo is intentionally ephemeral: the deleted record is
  // held only in memory and is never leaked to a network or separate origin.
  taskUndoDelete.addEventListener("click", () => {
    if (!pendingDeletedTask) return;
    try {
      const restored = restoreDeletedTask(
        taskQueue, pendingDeletedTask.task, pendingDeletedTask.index
      );
      persistTaskQueue(restored);
      pendingDeletedTask = null;
      taskDeleteRecovery.hidden = true;
      renderTaskQueue();
      taskAddStatus.textContent = "Deleted task restored on this iPhone.";
    } catch (error) {
      taskUndoSummary.textContent = "Could not restore yet: " + error.message
        + " Your other saved tasks are unchanged.";
    }
  });
  // Other Preview subdomains have isolated browser storage. Never attempt a
  // cross-origin read or claim an automatic sync: use the existing validated,
  // owner-confirmed JSON import instead.
  taskTransferChoose.addEventListener("click", () => {
    taskBackupPanel.open = true;
    taskBackupFile.click();
  });
  // Backup is entirely local; downloading JSON never sends task data to any API.
  taskBackupExport.addEventListener("click", () => {
    try {
      const content = createTaskQueueBackup(taskQueue);
      const blob = new Blob([content], {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "jomy-task-backup-" + localCalendarDate() + ".json";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      taskBackupStatus.textContent = "Backup prepared for download: " + taskQueue.length + " tasks. Keep the JSON file private.";
    } catch (error) {
      taskBackupStatus.textContent = "Backup export failed: " + error.message;
    }
  });
  taskBackupFile.addEventListener("change", async () => {
    pendingBackupTasks = null;
    taskBackupImport.disabled = true;
    const file = taskBackupFile.files?.[0];
    if (!file) {
      taskBackupStatus.textContent = "Select a JOMY task backup file.";
      return;
    }
    try {
      if (file.size > 524288) throw new TypeError("Backup file is too large (maximum 512 KB).");
      const incoming = readTaskQueueBackup(await file.text());
      const preview = mergeTaskQueueBackup(taskQueue, incoming);
      taskBackupStatus.textContent = "Preview: " + incoming.length + " saved tasks, "
        + preview.imported + " new, " + preview.duplicates + " already here, "
        + preview.full + " without space. Nothing has been imported yet.";
      if (preview.imported > 0) {
        pendingBackupTasks = incoming;
        taskBackupImport.disabled = false;
      }
    } catch (error) {
      taskBackupStatus.textContent = "Backup rejected: " + error.message;
    }
  });
  taskBackupImport.addEventListener("click", () => {
    if (!pendingBackupTasks) return;
    try {
      // Recalculate against live saved tasks in case anything changed since preview.
      const preview = mergeTaskQueueBackup(taskQueue, pendingBackupTasks);
      if (!preview.imported) {
        taskBackupStatus.textContent = "No new tasks to import. Your saved tasks are unchanged.";
        return;
      }
      if (!window.confirm("Import " + preview.imported + " NEW tasks on this device? "
          + preview.duplicates + " duplicates and " + preview.full
          + " over the 30-task limit will be skipped. Existing tasks will not be replaced.")) {
        return;
      }
      // Commit to storage BEFORE changing in-memory queue; failed writes leave UI intact.
      localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(preview.queue));
      taskQueue = preview.queue;
      pendingBackupTasks = null;
      taskBackupFile.value = "";
      taskBackupImport.disabled = true;
      activeTaskFilter = "all";
      activeDeadlineFilter = "all";
      activeCalendarDay = "";
      activeFocusTaskId = "";
      taskSearchInput.value = "";
      renderTaskQueue();
      taskBackupStatus.textContent = "Imported " + preview.imported + " new tasks. "
        + preview.duplicates + " duplicates and " + preview.full
        + " over-limit tasks skipped. Existing tasks were not changed.";
    } catch (error) {
      taskBackupStatus.textContent = "Import failed. Existing tasks were not changed: " + error.message;
    }
  });
  // Reusable task templates are a separate, explicitly owner-controlled local list.
  function renderTaskTemplates() {
    taskTemplateCount.textContent = taskTemplates.length + "/" + MAX_TASK_TEMPLATES;
    taskTemplateList.replaceChildren();
    if (!taskTemplates.length) {
      const empty = document.createElement("p");
      empty.className = "task-template-empty";
      empty.textContent = "No templates yet. Choose SAVE TEMPLATE on one of your tasks.";
      taskTemplateList.append(empty);
      return;
    }
    for (const template of taskTemplates) {
      const row = document.createElement("div");
      row.className = "task-template-item";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = template.title;
      const meta = document.createElement("small");
      meta.textContent = template.steps.length + " steps · "
        + (template.priority === "none" ? "No priority" : template.priority.toUpperCase() + " priority")
        + (template.tags.length ? " · " + template.tags.map(tag => "#" + tag).join(" ") : "");
      info.append(title, meta);
      const actions = document.createElement("div");
      actions.className = "task-template-actions";
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = "USE";
      use.setAttribute("aria-label", "Use task template " + template.title);
      use.addEventListener("click", () => {
        try {
          if (taskQueue.length >= 30) throw new Error("Task Queue is full (30/30). No task was changed.");
          const task = createTaskFromTemplate(template);
          const next = addTask(taskQueue, task);
          localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(next));
          taskQueue = next;
          activeTaskFilter = "all";
          activeDeadlineFilter = "all";
          activeCalendarDay = "";
          activeFocusTaskId = "";
          taskSearchInput.value = "";
          renderTaskQueue();
          taskTemplateStatus.textContent = "Created a new READY manual task from " + template.title
            + ". No AI planning or external action was run.";
        } catch (error) {
          taskTemplateStatus.textContent = "Template not used: " + error.message;
        }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "REMOVE";
      remove.setAttribute("aria-label", "Remove template " + template.title);
      remove.addEventListener("click", () => {
        if (!window.confirm("Remove saved template '" + template.title + "'? Existing tasks stay unchanged.")) return;
        try {
          const next = taskTemplates.filter(item => item.id !== template.id);
          localStorage.setItem(TASK_TEMPLATES_KEY, JSON.stringify(next));
          taskTemplates = next;
          renderTaskTemplates();
          taskTemplateStatus.textContent = "Template removed. Existing tasks were not changed.";
        } catch (error) {
          taskTemplateStatus.textContent = "Template not removed: " + error.message;
        }
      });
      actions.append(use, remove);
      row.append(info, actions);
      taskTemplateList.append(row);
    }
  }
  function saveTaskAsTemplate(taskId) {
    try {
      const task = taskQueue.find(item => item.id === taskId);
      if (!task) throw new Error("Task not found.");
      const next = addTaskTemplate(taskTemplates, createTaskTemplate(task));
      localStorage.setItem(TASK_TEMPLATES_KEY, JSON.stringify(next));
      taskTemplates = next;
      renderTaskTemplates();
      taskTemplatesPanel.open = true;
      taskTemplateStatus.textContent = "Saved reusable template: " + task.title
        + ". Existing task, its notes and checklist are unchanged.";
    } catch (error) {
      taskTemplatesPanel.open = true;
      taskTemplateStatus.textContent = "Template not saved: " + error.message;
    }
  }
  function updateTask(taskId, updater) {
    const nextQueue = taskQueue.map(task => task.id === taskId ? updater(task) : task);
    persistTaskQueue(nextQueue);
    renderTaskQueue();
  }
  // Explicit local-save only; task notes never enter AI planning or network calls.
  function saveManualTaskAnnotations(taskId, note, tags) {
    try {
      const next = taskQueue.map(task => task.id === taskId
        ? setTaskAnnotations(task, {note, tags}) : task);
      // Persist first: do not say "saved" when iPhone storage rejects a write.
      localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(next));
      taskQueue = next;
      renderTaskQueue();
      const editor = [...taskList.querySelectorAll(".task-notes-panel")]
        .find(panel => panel.dataset.taskId === taskId);
      if (editor) {
        editor.open = true;
        editor.querySelector(".task-notes-status").textContent = "Notes and tags saved on this device.";
      }
    } catch (error) {
      const editor = [...taskList.querySelectorAll(".task-notes-panel")]
        .find(panel => panel.dataset.taskId === taskId);
      if (editor) editor.querySelector(".task-notes-status").textContent = "Not saved: " + error.message;
    }
  }
  // Only the owner changes these manual progress states; no API request is made.
  function setManualTaskProgress(taskId, nextStatus) {
    const current = taskQueue.find(task => task.id === taskId);
    if (!current) return;
    try {
      updateTask(taskId, task => transitionTask(task, nextStatus));
    } catch (error) {
      // Keep the existing record untouched if the transition is no longer valid.
      console.warn("JOMY_MANUAL_TASK_STATUS_REJECTED", error?.name || "Error");
    }
  }
  // Priority and date are local owner labels only. This never executes a task.
  function setManualTaskSchedule(taskId, changes) {
    try {
      updateTask(taskId, task => setTaskSchedule(task, changes));
    } catch (error) {
      console.warn("JOMY_TASK_SCHEDULE_UPDATE_REJECTED", error?.name || "Error");
    }
  }
  // Checklist controls only change local task metadata. They never call the Worker.
  function setManualStepProgress(taskId, stepIndex, checked) {
    const task = taskQueue.find(item => item.id === taskId);
    if (!task) return;
    try {
      updateTask(taskId, item => setChecklistStepChecked(item, stepIndex, checked));
    } catch (error) {
      console.warn("JOMY_CHECKLIST_UPDATE_REJECTED", error?.name || "Error");
    }
  }
  async function planTask(taskId) {
    let task = taskQueue.find(item => item.id === taskId);
    if (!task) return;
    try {
      if (task.status === TASK_STATES.FAILED) task = retryTask(task);
      if (task.status !== TASK_STATES.QUEUED) return;
      // A general request without named work must not turn into invented meetings.
      const planningText = typeof task.details === "string" && task.details.trim() ? task.details.trim() : task.title;
      if (needsTaskDetails(planningText)) {
        task = transitionTask(task, TASK_STATES.NEEDS_DETAILS);
        updateTask(taskId, () => task);
        return;
      }
      task = transitionTask(task, TASK_STATES.PLANNING);
      updateTask(taskId, () => task);
      if (!endpoint || !ownerToken) throw new Error("Settings mein Agent API URL aur Owner token save karo.");
      // Use the dedicated, authenticated planning endpoint. Chat responses are
      // free-form prose and must not be parsed as task plans.
      const planEndpoint = new URL(endpoint);
      planEndpoint.pathname = "/api/agent/plan";
      const response = await fetch(planEndpoint.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ownerToken },
        body: JSON.stringify({ task: planningText })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The authenticated route sometimes returns malformed model output.
        // If that *specific* failure occurs, retain the supplied task names
        // in a clearly labelled local checklist instead of inventing tasks.
        // Auth, rate-limit, permission, and billing failures are NOT masked.
        if (response.status === 502 && data.code === "TASK_PLAN_FAILED") {
          const localPlan = createLocalTaskOutline(planningText);
          const locallyPlanned = transitionTask(task, TASK_STATES.READY, { steps: localPlan.steps });
          locallyPlanned.plan = localPlan;
          updateTask(taskId, () => locallyPlanned);
          return;
        }
        const detail = response.status === 404
          ? "Task Plan API route not found. No action was performed."
          : data.error || "Task planning failed. No action was performed.";
        throw new Error(detail);
      }
      if (data.status !== "planned" || !data.plan || typeof data.plan !== "object" || Array.isArray(data.plan)) {
        throw new Error("Task Plan API did not return a valid plan. No action was performed.");
      }
      // Keep client-side plan validation even if the API claims success.
      const plan = parseTaskPlan(JSON.stringify(data.plan), planningText);
      const nextStatus = plan.actionType === "unsupported"
        ? TASK_STATES.BLOCKED
        : plan.requiresApproval ? TASK_STATES.AWAITING_APPROVAL : TASK_STATES.READY;
      const planned = transitionTask(task, nextStatus, { steps: plan.steps });
      planned.plan = plan;
      updateTask(taskId, () => planned);
    } catch (error) {
      const current = taskQueue.find(item => item.id === taskId);
      if (current && current.status === TASK_STATES.PLANNING) {
        const failed = transitionTask(current, TASK_STATES.FAILED, { error: error.message });
        updateTask(taskId, () => failed);
      }
    }
  }
  // JOMY 3.2: read-only weekly progress from currently retained local tasks.
  function renderWeeklyGoal() {
    const summary = summarizeWeeklyTaskGoal(taskQueue, weeklyGoalTarget ?? 5, new Date());
    weeklyGoalPeriod.textContent = "WEEK: " + summary.weekStart + " to " + summary.weekEnd;
    weeklyGoalProgress.textContent = weeklyGoalTarget === null
      ? "Goal not set" : summary.completed + " / " + summary.target + " manually done";
    const percent = weeklyGoalTarget === null ? 0 : summary.percent;
    weeklyGoalPercentage.textContent = percent + "%";
    weeklyGoalBar.setAttribute("aria-valuenow", String(percent));
    weeklyGoalFill.style.width = percent + "%";
    if (weeklyGoalTarget === null) {
      weeklyGoalStatus.textContent = "Goal not saved yet. Save a target to start tracking.";
    } else if (summary.reached) {
      weeklyGoalStatus.textContent = "Weekly goal reached: " + summary.completed + " manual completions counted.";
    } else {
      weeklyGoalStatus.textContent = summary.remaining + " more manual completions to reach your goal.";
    }
  }
  weeklyGoalForm.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const target = validateWeeklyTaskGoal(Number(weeklyGoalInput.value));
      localStorage.setItem(WEEKLY_GOAL_KEY, JSON.stringify({ target }));
      weeklyGoalTarget = target;
      renderWeeklyGoal();
    } catch (error) {
      weeklyGoalStatus.textContent = "Goal not saved: " + error.message;
    }
  });
  // JOMY 3.1: numeric daily counts only, computed in-browser from saved tasks.
  function renderTaskReport() {
    const days = Number(reportRangeSelect.value);
    const report = summarizeTaskActivityReport(taskQueue, days, new Date());
    reportCreated.textContent = String(report.created);
    reportDone.textContent = String(report.manuallyDone);
    reportTopDay.textContent = report.bestDay
      ? "Top manual completion day: " + report.bestDay.date
        + " (" + report.bestDay.manuallyDone + " task(s))"
      : "Top completion day: No recorded manual completions in this period.";
  }
  reportRangeSelect.addEventListener("change", renderTaskReport);
  reportExport.addEventListener("click", () => {
    try {
      const days = Number(reportRangeSelect.value);
      const csv = createTaskActivityCsv(taskQueue, days, new Date());
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "jomy-productivity-" + days + "d-" + localCalendarDate() + ".csv";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      reportStatus.textContent = "CSV prepared for download: " + days
        + " daily rows, counts only. No task names or private notes included.";
    } catch (error) {
      reportStatus.textContent = "CSV export failed: " + error.message;
    }
  });
  // Read-only, device-local analytics. Legacy finished tasks without an actual
  // completion timestamp are deliberately excluded from daily completion bars.
  function renderTaskInsights() {
    renderTaskReport();
    renderWeeklyGoal();
    const analytics = summarizeTaskAnalytics(taskQueue, new Date());
    insightsDone.textContent = String(analytics.done);
    insightsRate.textContent = String(analytics.completionRate) + "%";
    insightsCreatedToday.textContent = String(analytics.todayCreated);
    insightsDoneToday.textContent = String(analytics.todayCompleted);
    insightsWeek.textContent = "LAST 7 DAYS · " + analytics.last7Created
      + " created · " + analytics.last7Completed + " manually done";
    insightsBars.replaceChildren();
    const max = Math.max(1, ...analytics.days.map(day => Math.max(day.created, day.completed)));
    for (const day of analytics.days) {
      const column = document.createElement("div");
      column.className = "task-insights-day";
      column.setAttribute("aria-label", day.day + ": " + day.created + " created, " + day.completed + " manually done");
      const bars = document.createElement("div");
      bars.className = "task-insights-day-bars";
      const created = document.createElement("span");
      created.className = "task-insights-bar is-created";
      created.style.height = String(day.created / max * 100) + "%";
      const done = document.createElement("span");
      done.className = "task-insights-bar is-done";
      done.style.height = String(day.completed / max * 100) + "%";
      bars.append(created, done);
      const label = document.createElement("span");
      label.className = "task-insights-day-label";
      label.textContent = day.label;
      column.append(bars, label);
      insightsBars.append(column);
    }
    insightsNote.textContent = "Only tasks still saved on this device count. Daily completions need a recorded manual DONE date."
      + (analytics.undatedCompleted ? " " + analytics.undatedCompleted + " finished task(s) have no usable completion date." : "")
      + " No server analytics, reminders or external execution.";
  }
  // JOMY 3.4: a read-only daily shortlist from local tasks. Nothing is executed.
  function renderDailyFocus() {
    const plan = summarizeDailyFocusPlan(taskQueue, new Date(), 5);
    if (activeFocusTaskId && !plan.focus.some(item => item.id === activeFocusTaskId)) {
      activeFocusTaskId = "";
    }
    const {overdue, dueToday, highPriority} = plan.counts;
    taskFocusSummary.textContent = plan.focus.length + " suggested of " + plan.totalOpen
      + " unfinished · " + overdue + " overdue · " + dueToday
      + " due today · " + highPriority + " other high priority";
    const progress = summarizeDailyTaskProgress(taskQueue, new Date());
    taskFocusProgressLabel.textContent = progress.completedToday + " manually done today · "
      + progress.unfinished + " unfinished · " + progress.percent + "%";
    taskFocusProgress.setAttribute("aria-valuenow", String(progress.percent));
    taskFocusProgress.setAttribute("aria-valuetext", progress.completedToday
      + " tasks manually done today; " + progress.unfinished
      + " unfinished saved tasks; " + progress.percent + " percent of current snapshot");
    taskFocusProgressFill.style.width = progress.percent + "%";
    taskFocusList.replaceChildren();
    if (!plan.focus.length) {
      const empty = document.createElement("p");
      empty.className = "task-focus-empty";
      empty.textContent = "No unfinished tasks. Add a task to see today's focus.";
      taskFocusList.append(empty);
    }
    const categories = {
      overdue: "OVERDUE", dueToday: "DUE TODAY",
      highPriority: "HIGH PRIORITY", upcoming: "UPCOMING", other: "OTHER"
    };
    for (const [index, item] of plan.focus.entries()) {
      const row = document.createElement("div");
      row.className = "task-focus-item";
      const summary = document.createElement("div");
      summary.className = "task-focus-item-summary";
      const heading = document.createElement("strong");
      heading.textContent = (index + 1) + ". " + item.title;
      const meta = document.createElement("small");
      meta.textContent = categories[item.category] + " · "
        + (item.priority === "none" ? "No priority" : item.priority.toUpperCase())
        + (item.dueDate ? " · due " + item.dueDate : "");
      summary.append(heading, meta);
      const view = document.createElement("button");
      view.type = "button";
      view.className = "task-focus-view";
      view.textContent = "VIEW TASK";
      view.dataset.focusTaskId = item.id;
      view.setAttribute("aria-pressed", String(activeFocusTaskId === item.id));
      view.setAttribute("aria-label", "Show focus task: " + item.title);
      view.addEventListener("click", () => {
        activeFocusTaskId = activeFocusTaskId === item.id ? "" : item.id;
        activeCalendarDay = "";
        activeTaskFilter = "all";
        activeDeadlineFilter = "all";
        taskSearchInput.value = "";
        renderTaskQueue();
        if (activeFocusTaskId) {
          // iPhone: show the selected card instead of leaving the user above the list.
          const selectedCard = taskList.querySelector('.task-item[data-daily-focus="true"]');
          if (selectedCard) {
            selectedCard.focus({ preventScroll: true });
            selectedCard.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } else {
          // Toggling the same suggestion off rebuilds the focus list; restore
          // keyboard/VoiceOver focus to its newly-rendered button.
          const restoredButton = Array.from(taskFocusList.querySelectorAll(".task-focus-view"))
            .find(button => button.dataset.focusTaskId === item.id);
          restoredButton?.focus({ preventScroll: true });
        }
      });
      row.append(summary, view);
      taskFocusList.append(row);
    }
    taskFocusClear.disabled = !activeFocusTaskId;
  }
  taskFocusClear.addEventListener("click", () => {
    activeFocusTaskId = "";
    renderTaskQueue();
  });
  // Local-calendar date view: no external requests, no storage writes and no timers.
  function renderUpcomingCalendar() {
    const overview = summarizeUpcomingCalendar(taskQueue, new Date());
    if (activeCalendarDay && !overview.days.some(day => day.date === activeCalendarDay)) {
      activeCalendarDay = "";
    }
    calendarSummary.textContent = overview.upcoming + " upcoming · " + overview.overdue
      + " overdue · " + overview.unscheduled + " without due date · "
      + overview.later + " later";
    calendarDays.replaceChildren();
    for (const day of overview.days) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "task-calendar-day";
      button.dataset.calendarDate = day.date;
      button.setAttribute("aria-pressed", String(activeCalendarDay === day.date));
      button.setAttribute("aria-label", day.label + ": " + day.tasks.length
        + " unfinished tasks due. Filter Task Queue by this date.");
      const label = document.createElement("span");
      label.className = "task-calendar-day-label";
      label.textContent = day.label;
      const count = document.createElement("strong");
      count.className = "task-calendar-day-count";
      count.textContent = day.tasks.length + (day.tasks.length === 1 ? " task" : " tasks");
      button.append(label, count);
      const preview = document.createElement("small");
      preview.className = "task-calendar-preview";
      preview.textContent = day.tasks.length ? day.tasks.slice(0,2).map(task => task.title).join(" · ")
        : "No deadlines";
      button.append(preview);
      button.addEventListener("click", () => {
        activeCalendarDay = activeCalendarDay === day.date ? "" : day.date;
        activeFocusTaskId = "";
        activeTaskFilter = "all";
        activeDeadlineFilter = "all";
        taskSearchInput.value = "";
        renderTaskQueue();
      });
      calendarDays.append(button);
    }
    calendarClear.disabled = !activeCalendarDay;
  }
  calendarClear.addEventListener("click", () => {
    activeCalendarDay = "";
    renderTaskQueue();
  });
  // Dashboard counts are derived from existing local tasks, never guessed or fetched.
  function renderTaskDashboard() {
    const counts = summarizeTaskQueue(taskQueue);
    for (const button of taskDashboardButtons) {
      const filter = button.dataset.taskFilter;
      button.querySelector(".task-stat-number").textContent = String(counts[filter]);
      button.setAttribute("aria-pressed", String(activeTaskFilter === filter));
    }
    const today = localCalendarDate();
    const dueCounts = summarizeTaskDeadlines(taskQueue, today);
    for (const button of deadlineButtons) {
      const filter = button.dataset.deadlineFilter;
      const number = button.querySelector(".task-deadline-count");
      if (number) number.textContent = String(dueCounts[filter]);
      button.setAttribute("aria-pressed", String(activeDeadlineFilter === filter));
    }
    const visibleTasks = filterTaskDeadlines(
      filterTaskQueue(taskQueue, activeTaskFilter), activeDeadlineFilter, today
    ).filter(task => (!activeFocusTaskId || task.id === activeFocusTaskId)
      && (!activeCalendarDay || (
        getTaskSchedule(task).dueDate === activeCalendarDay
        && task.status !== TASK_STATES.DONE && task.status !== TASK_STATES.SUCCEEDED
      )));
    const names = { pending: "pending / needs attention", in_progress: "in progress", done: "done" };
    const selected = searchAndSortTaskQueue(visibleTasks, taskSearchInput.value, taskSortSelect.value);
    const searchText = taskSearchInput.value.trim();
    const label = activeTaskFilter === "all" ? "tasks" : names[activeTaskFilter] + " tasks";
    const dueLabel = { today: " · due today", overdue: " · overdue", all: "" }[activeDeadlineFilter];
    const calendarLabel = activeCalendarDay ? " · due " + activeCalendarDay : "";
    const focusLabel = activeFocusTaskId ? " · daily focus selected" : "";
    taskFilterSummary.textContent = "Showing " + selected.length + " of " + counts.all + " " + label
      + dueLabel + calendarLabel + focusLabel + (searchText ? " matching your search" : "")
      + " · saved on this device.";
    return selected;
  }
  function renderTaskQueue() {
    taskCount.textContent = taskQueue.length + "/30";
    taskTransferPanel.hidden = taskQueue.length !== 0;
    renderTaskInsights();
    renderDailyFocus();
    renderUpcomingCalendar();
    const visibleTasks = renderTaskDashboard();
    taskList.replaceChildren();
    if (!visibleTasks.length) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = !taskQueue.length
        ? "No tasks yet. Add a task you want JOMY to organize."
        : taskSearchInput.value.trim()
          ? "No tasks match your search. Try a different name or clear search."
          : activeFocusTaskId
            ? "Selected focus task is not visible. Tap SHOW ALL TASKS in Daily Planner."
            : activeCalendarDay
              ? "No unfinished tasks due on " + activeCalendarDay + ". Tap SHOW ALL DATES in Calendar."
              : activeDeadlineFilter !== "all"
              ? "No tasks due in this view. Tap ALL DATES to see other tasks."
              : "No tasks match this filter. Tap TOTAL to see all tasks.";
      taskList.append(empty);
      return;
    }
    for (const task of visibleTasks) {
      const item = document.createElement("article");
      item.className = "task-item";
      if (activeFocusTaskId === task.id) {
        item.tabIndex = -1;
        item.dataset.dailyFocus = "true";
      }
      const details = document.createElement("div");
      details.className = "task-details";
      const title = document.createElement("strong");
      title.textContent = task.title;
      const status = document.createElement("small");
      const displayStatus = task.status === TASK_STATES.IN_PROGRESS ? "IN PROGRESS (MANUAL)"
        : task.status === TASK_STATES.DONE ? "DONE (MANUAL)"
        : task.status.replaceAll("_", " ").toUpperCase();
      status.textContent = displayStatus + " · " + new Date(task.updatedAt || task.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" });
      details.append(title, status);

      // Every existing task can be labelled without changing its lifecycle.
      const schedule = getTaskSchedule(task);
      const scheduleEditor = document.createElement("div");
      scheduleEditor.className = "task-schedule";
      const priorityLabel = document.createElement("label");
      const priorityTitle = document.createElement("span");
      priorityTitle.textContent = "PRIORITY";
      const prioritySelect = document.createElement("select");
      prioritySelect.className = "task-priority-select";
      prioritySelect.setAttribute("aria-label", "Priority for " + task.title);
      for (const [value, text] of [["none", "Not set"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        prioritySelect.append(option);
      }
      prioritySelect.value = schedule.priority;
      prioritySelect.addEventListener("change", () => setManualTaskSchedule(task.id, { priority: prioritySelect.value }));
      priorityLabel.append(priorityTitle, prioritySelect);

      const dueLabel = document.createElement("label");
      const dueTitle = document.createElement("span");
      dueTitle.textContent = "DUE DATE (OPTIONAL)";
      const dueInput = document.createElement("input");
      dueInput.type = "date";
      dueInput.className = "task-due-date";
      dueInput.value = schedule.dueDate;
      dueInput.setAttribute("aria-label", "Due date for " + task.title);
      dueInput.addEventListener("change", () => setManualTaskSchedule(task.id, { dueDate: dueInput.value }));
      dueLabel.append(dueTitle, dueInput);
      scheduleEditor.append(priorityLabel, dueLabel);
      details.append(scheduleEditor);

      const annotation = getTaskAnnotations(task);
      if (annotation.tags.length) {
        const badges = document.createElement("div");
        badges.className = "task-tag-list";
        for (const tag of annotation.tags) {
          const badge = document.createElement("span");
          badge.className = "task-tag";
          badge.textContent = "#" + tag;
          badges.append(badge);
        }
        details.append(badges);
      }
      const editor = document.createElement("details");
      editor.className = "task-notes-panel";
      editor.dataset.taskId = task.id;
      const editorHeading = document.createElement("summary");
      editorHeading.textContent = "NOTES & TAGS · " + annotation.tags.length + " TAGS"
        + (annotation.note ? " · NOTE SAVED" : "");
      const editorNote = document.createElement("label");
      editorNote.textContent = "PRIVATE TASK NOTE · MAX 1000";
      const noteInput = document.createElement("textarea");
      noteInput.className = "task-note-input";
      noteInput.maxLength = 1000;
      noteInput.rows = 3;
      noteInput.value = annotation.note;
      noteInput.placeholder = "Add your own note (saved only on this device)";
      noteInput.setAttribute("aria-label", "Private note for " + task.title);
      editorNote.append(noteInput);
      const editorTags = document.createElement("label");
      editorTags.textContent = "TAGS · UP TO 5, COMMA-SEPARATED";
      const tagsInput = document.createElement("input");
      tagsInput.type = "text";
      tagsInput.className = "task-tags-input";
      tagsInput.maxLength = 140;
      tagsInput.value = annotation.tags.join(", ");
      tagsInput.placeholder = "e.g. Work, Urgent, Personal";
      tagsInput.setAttribute("aria-label", "Tags for " + task.title);
      editorTags.append(tagsInput);
      const saveNotes = document.createElement("button");
      saveNotes.type = "button";
      saveNotes.className = "task-annotation-save";
      saveNotes.textContent = "SAVE NOTES & TAGS";
      saveNotes.addEventListener("click", () =>
        saveManualTaskAnnotations(task.id, noteInput.value, tagsInput.value));
      const annotationStatus = document.createElement("small");
      annotationStatus.className = "task-notes-status";
      annotationStatus.setAttribute("role", "status");
      annotationStatus.setAttribute("aria-live", "polite");
      editor.append(editorHeading, editorNote, editorTags, saveNotes, annotationStatus);
      details.append(editor);

      const dueState = taskDueState(task, localCalendarDate());
      if (dueState === "today" || dueState === "overdue") {
        const warning = document.createElement("small");
        warning.className = "task-due-alert is-" + dueState;
        warning.textContent = (dueState === "today" ? "DUE TODAY" : "OVERDUE") + " · " + schedule.dueDate;
        details.append(warning);
      }

      if (typeof task.details === "string" && task.details.trim()) {
        const actualTasks = document.createElement("p");
        actualTasks.className = "task-summary";
        actualTasks.textContent = "Your real tasks: " + task.details.trim();
        actualTasks.style.whiteSpace = "pre-line";
        details.append(actualTasks);
      }
      if (task.status === TASK_STATES.NEEDS_DETAILS) {
        const note = document.createElement("p");
        note.className = "task-summary";
        note.textContent = "Aapne kaunse asli kaam karne hain? JOMY aapki taraf se meeting ya project nahi banayega.";
        const detailForm = document.createElement("form");
        detailForm.className = "task-details-form";
        const detailInput = document.createElement("textarea");
        detailInput.setAttribute("aria-label", "List your actual tasks");
        detailInput.placeholder = "1. Pehla asli kaam\n2. Dusra asli kaam\n3. Teesra asli kaam";
        detailInput.maxLength = 4000;
        detailInput.rows = 3;
        detailInput.required = true;
        const confirmButton = document.createElement("button");
        confirmButton.type = "submit";
        confirmButton.textContent = "SAVE & PLAN";
        detailForm.addEventListener("submit", (event) => {
          event.preventDefault();
          const actualText = detailInput.value.trim();
          if (!actualText || needsTaskDetails(actualText)) {
            detailInput.setCustomValidity("Apne asli kaam ke naam likho. Sirf '3 important kaam' kaafi nahi hai.");
            detailInput.reportValidity();
            detailInput.setCustomValidity("");
            return;
          }
          updateTask(task.id, (current) => ({
            ...transitionTask(current, TASK_STATES.QUEUED),
            details: actualText,
            plan: undefined,
            steps: [],
            lastError: null
          }));
          planTask(task.id);
        });
        detailForm.append(detailInput, confirmButton);
        details.append(note, detailForm);
      }
      if (task.plan?.summary) {
        const summary = document.createElement("p");
        summary.className = "task-summary";
        summary.textContent = task.plan.summary;
        details.append(summary);
      }
      if (Array.isArray(task.steps) && task.steps.length) {
        const canCheck = [TASK_STATES.READY, TASK_STATES.IN_PROGRESS, TASK_STATES.DONE].includes(task.status);
        const checklist = canCheck ? getChecklistProgress(task) : null;
        if (canCheck) {
          const progressText = document.createElement("small");
          progressText.className = "task-progress-label";
          progressText.textContent = "CHECKLIST · " + checklist.done + "/" + checklist.total + " steps checked (manual)";
          const meter = document.createElement("progress");
          meter.className = "task-progress-meter";
          meter.max = checklist.total;
          meter.value = checklist.done;
          meter.setAttribute("aria-label", "Manually checked steps: " + checklist.done + " of " + checklist.total);
          details.append(progressText, meter);
        }
        const steps = document.createElement("ol");
        steps.className = canCheck ? "task-steps task-checklist" : "task-steps";
        for (const [index, step] of task.steps.entries()) {
          const line = document.createElement("li");
          if (canCheck) {
            const row = document.createElement("label");
            row.className = "task-check-row";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = checklist.indices.includes(index);
            checkbox.setAttribute("aria-label", "Step " + (index + 1) + ": " + step);
            checkbox.addEventListener("change", () => setManualStepProgress(task.id, index, checkbox.checked));
            const labelText = document.createElement("span");
            labelText.textContent = step;
            row.append(checkbox, labelText);
            line.append(row);
          } else {
            line.textContent = step;
          }
          steps.append(line);
        }
        details.append(steps);
      }
      if (task.status === TASK_STATES.READY) {
        const note = document.createElement("small");
        note.textContent = task.plan?.source === "local"
          ? "Basic local checklist · AI planning unavailable · No external action has been executed."
          : "Plan ready · No external action has been executed.";
        details.append(note);
      }
      if (task.status === TASK_STATES.IN_PROGRESS) {
        const note = document.createElement("small");
        note.textContent = "You marked this in progress · No work executed by JOMY.";
        details.append(note);
      }
      if (task.status === TASK_STATES.DONE) {
        const note = document.createElement("small");
        note.textContent = "You marked this done · No external action was executed by JOMY.";
        details.append(note);
      }
      if (task.status === TASK_STATES.BLOCKED) {
        const note = document.createElement("small");
        note.textContent = "Needs an integration that is not connected. Nothing was executed.";
        details.append(note);
      }
      // An older build may have stored a failure message on a task now READY.
      // Only show errors for task states that actually represent a problem.
      if (task.lastError && [TASK_STATES.FAILED, TASK_STATES.RETRY_WAIT, TASK_STATES.BLOCKED].includes(task.status)) {
        const error = document.createElement("small");
        error.className = "task-error";
        error.textContent = task.lastError;
        details.append(error);
      }
      const actions = document.createElement("div");
      actions.className = "task-actions";
      const templateButton = document.createElement("button");
      templateButton.type = "button";
      templateButton.className = "task-action";
      templateButton.textContent = "SAVE TEMPLATE";
      templateButton.setAttribute("aria-label", "Save task as template: " + task.title);
      templateButton.addEventListener("click", () => saveTaskAsTemplate(task.id));
      actions.append(templateButton);
      if (task.status === TASK_STATES.QUEUED || task.status === TASK_STATES.FAILED) {
        const planButton = document.createElement("button");
        planButton.type = "button";
        planButton.className = "task-action";
        planButton.textContent = task.status === TASK_STATES.FAILED ? "RETRY PLAN" : "PLAN";
        planButton.addEventListener("click", () => planTask(task.id));
        actions.append(planButton);
      }
      if ([TASK_STATES.READY, TASK_STATES.IN_PROGRESS, TASK_STATES.DONE].includes(task.status)) {
        const availableActions = task.status === TASK_STATES.READY
          ? [["START", TASK_STATES.IN_PROGRESS], ["MARK DONE", TASK_STATES.DONE]]
          : task.status === TASK_STATES.IN_PROGRESS
            ? [["MARK DONE", TASK_STATES.DONE], ["PAUSE", TASK_STATES.READY]]
            : [["REOPEN", TASK_STATES.READY]];
        for (const [label, nextStatus] of availableActions) {
          const actionButton = document.createElement("button");
          actionButton.type = "button";
          actionButton.className = "task-action";
          actionButton.textContent = label;
          actionButton.setAttribute("aria-label", label + ": " + task.title);
          actionButton.addEventListener("click", () => setManualTaskProgress(task.id, nextStatus));
          actions.append(actionButton);
        }
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "task-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove task");
      remove.addEventListener("click", () => {
        try {
          const index = taskQueue.findIndex(entry => entry.id === task.id);
          if (index < 0) return;
          const deleted = taskQueue[index];
          // Save the reduced queue first; do not offer undo for an unsaved delete.
          persistTaskQueue(taskQueue.filter(entry => entry.id !== deleted.id));
          pendingDeletedTask = {task: deleted, index};
          taskUndoSummary.textContent = "Removed: " + deleted.title
            + ". UNDO is available until refresh or the next deletion.";
          taskDeleteRecovery.hidden = false;
          renderTaskQueue();
          taskUndoDelete.focus({preventScroll:true});
          taskDeleteRecovery.scrollIntoView({behavior:"smooth",block:"nearest"});
        } catch (error) {
          console.warn("JOMY_TASK_REMOVE_NOT_SAVED", error?.name || "Error");
        }
      });
      actions.append(remove);
      item.append(details, actions);
      taskList.append(item);
    }
  }
  function wakeActivityBoard() {
    messages.hidden = false;
    taskPanel.hidden = false;
    activityToggle.setAttribute("aria-expanded", "true");
    $("activityChevron").textContent = "−";
    if (emptyState) emptyState.textContent = "JOMY is awake. Tell me what you need.";
    activityBoard.classList.add("is-awake");
    window.setTimeout(() => activityBoard.classList.remove("is-awake"), 2600);
  }
  function unlockSpeech() {
    if (!("speechSynthesis" in window) || !soundOn) return;
    try {
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      window.speechSynthesis.speak(primer);
      window.speechSynthesis.resume();
    } catch (_) {}
  }
  function speak(text) {
    if (!soundOn || !("speechSynthesis" in window)) {
      speakingReply = false;
      if (handsFree) startRecognition();
      return;
    }
    const speechText = prepareSpeechText(text);
    if (!speechText) {
      speakingReply = false;
      if (handsFree) startRecognition();
      return;
    }
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) {}
      listening = false;
    }
    const synth = window.speechSynthesis;
    synth.cancel();
    speakingReply = true;
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = "hi-IN";
    utterance.rate = 0.9;
    utterance.pitch = 1.04;
    utterance.volume = 1;
    // Prefer a warm-sounding Indian Hindi female voice when the device exposes one.
    // iOS does not expose a reliable voice-gender property, so name hints are best-effort.
    const selectedVoice = selectHindiFemaleVoice(synth.getVoices());
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
    utterance.onstart = () => setState("speaking", "SPEAKING", "JOMY is replying.");
    utterance.onend = () => {
      speakingReply = false;
      setState("idle", handsFree ? "HANDS-FREE ACTIVE" : "READY", handsFree ? "Say JOMY, then give your command." : "Your command center. Speak or type to begin.");
      if (handsFree) startRecognition();
    };
    utterance.onerror = (event) => {
      speakingReply = false;
      voiceHint.textContent = "Reply text is ready, but iPhone audio playback failed (" + (event.error || "unknown") + "). Tap Sound once, then try again.";
      setState("idle", "AUDIO PAUSED", "Tap Sound to re-enable voice replies.");
      if (handsFree) startRecognition();
    };
    synth.resume();
    synth.speak(utterance);
  }
  function startRecognition() {
    if (!recognition || !handsFree || document.hidden || busy || listening || recognitionStarting || recognitionBlocked || speakingReply) return;
    try {
      recognitionStarting = true;
      recognition.start();
    }
    catch (_) {
      recognitionStarting = false;
      recognitionBlocked = true;
      micLabel.textContent = "Tap to retry microphone";
      voiceHint.textContent = "Safari paused microphone startup. Tap the Hands-free button or microphone once to retry.";
      setState("idle", "MICROPHONE PAUSED", "Tap once to retry voice listening.");
    }
  }
  function stopHandsFree() {
    handsFree = false;
    localStorage.setItem(STORAGE_HANDSFREE, "false");
    waitingForCommand = false;
    const pendingTranscript = voiceFinalTranscript;
    const discardedCapture = discardPendingVoiceCapture({ transcript: voiceFinalTranscript, timer: voiceSendTimer });
    voiceFinalTranscript = discardedCapture.transcript;
    voiceSendTimer = discardedCapture.timer;
    discardVoiceResults = Boolean(recognition && listening);
    if (pendingTranscript && messageInput.value === pendingTranscript) messageInput.value = "";
    if (recognition && listening) {
      try { recognition.stop(); } catch (_) {}
    }
    listening = false;
    recognitionStarting = false;
    handsFreeButton.textContent = "Hands-free: Off";
    handsFreeButton.setAttribute("aria-pressed", "false");
    micLabel.textContent = "Tap to speak";
    setState("idle", "READY", "Hands-free is off. Tap the mic to speak.");
  }
  function stopListening() {
    if (recognition && listening) recognition.stop();
    listening = false;
    micLabel.textContent = "Tap to speak";
    micButton.setAttribute("aria-label", "Start voice input");
    if (!busy) setState("idle", "READY", "Your command center. Speak or type to begin.");
  }
  function submitVoiceTranscript() {
    const transcript = voiceFinalTranscript.trim();
    if (!transcript || busy || voiceSubmissionPending) return;
    clearTimeout(voiceSendTimer);
    voiceSendTimer = null;
    voiceFinalTranscript = "";
    voiceSubmissionPending = true;
    stopListening();
    sendMessage(transcript).finally(() => {
      voiceSubmissionPending = false;
    });
  }
  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      micButton.disabled = true;
      handsFreeButton.disabled = true;
      handsFreeButton.textContent = "Voice unavailable";
      micLabel.textContent = "Use keyboard dictation";
      voiceHint.textContent = "This browser does not expose speech recognition. On iPhone, tap the keyboard microphone and dictate into the message box.";
      return;
    }
    try {
      recognition = new SpeechRecognition();
    } catch (_) {
      // Some iOS web views expose SpeechRecognition but cannot construct it.
      micButton.disabled = true;
      handsFreeButton.disabled = true;
      handsFreeButton.textContent = "Voice unavailable";
      micLabel.textContent = "Use keyboard dictation";
      voiceHint.textContent = "Voice recognition is unavailable here; text chat and keyboard dictation can still work.";
      return;
    }
    recognition.lang = "hi-IN";
    recognition.maxAlternatives = 3;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onstart = () => {
      recognitionStarting = false;
      recognitionBlocked = false;
      listening = true;
      micLabel.textContent = handsFree ? "Listening for “JOMY”…" : "Listening… tap to stop";
      micButton.setAttribute("aria-label", "Stop voice input");
      setState("listening", handsFree ? "HANDS-FREE" : "LISTENING", handsFree ? "Say JOMY to wake me, then speak your command." : "I'm listening. Say your command.");
    };
    recognition.onresult = (event) => {
      if (discardVoiceResults) return;
      let finalText = "";
      let interimText = "";
      const finalCandidates = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += (finalText ? " " : "") + event.results[i][0].transcript;
          for (let j = 0; j < event.results[i].length; j++) {
            finalCandidates.push(event.results[i][j].transcript);
          }
        } else {
          interimText += event.results[i][0].transcript;
        }
      }
      if (!handsFree) {
        if (finalText) {
          voiceFinalTranscript = [voiceFinalTranscript, finalText].filter(Boolean).join(" ").trim();
          messageInput.value = voiceFinalTranscript;
          if (!busy && !voiceSubmissionPending) {
            clearTimeout(voiceSendTimer);
            voiceSendTimer = setTimeout(() => submitVoiceTranscript(), 900);
          }
        } else if (!voiceFinalTranscript) {
          messageInput.value = interimText;
        }
        return;
      }
      if (!finalText) return;
      const command = parseWakeCommand(finalText, finalCandidates, waitingForCommand);
      if (command === null) return;
      if (!command) {
        wakeActivityBoard();
        waitingForCommand = true;
        try { recognition.stop(); } catch (_) {}
        listening = false;
        speak("हाँ, बोलिए।");
        return;
      }
      waitingForCommand = false;
      if (/^(stop listening|stop|बंद करो|सुनना बंद करो|सुनना रोको)$/i.test(command.trim())) {
        stopHandsFree();
        return;
      }
      try { recognition.stop(); } catch (_) {}
      listening = false;
      sendMessage(command);
    };
    recognition.onerror = (event) => {
      recognitionStarting = false;
      listening = false;
      const fatalVoiceErrors = ["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported", "network"];
      if (fatalVoiceErrors.includes(event.error)) recognitionBlocked = true;
      micLabel.textContent = handsFree ? "Hands-free paused" : "Tap to speak";
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        micLabel.textContent = "Tap anywhere to retry";
        voiceHint.textContent = "Allow microphone access for this website in iPhone Settings or Safari, then tap Hands-free once to retry.";
        setState("idle", "MIC PERMISSION", "Allow microphone access, then tap to retry.");
      } else {
        const message = event.error === "audio-capture"
          ? "No microphone was found. Check iPhone microphone access."
          : event.error === "network"
            ? "Speech recognition network is unavailable. Check your connection."
            : event.error === "no-speech"
              ? "No speech detected. Say JOMY and try again."
              : "Voice input paused (" + event.error + "). Tap the microphone to retry.";
        voiceHint.textContent = message;
        setState("idle", "VOICE PAUSED", message);
      }
    };
    recognition.onend = () => {
      recognitionStarting = false;
      listening = false;
      if (discardVoiceResults) {
        discardVoiceResults = false;
      } else if (!handsFree && voiceFinalTranscript && !voiceSubmissionPending) {
        clearTimeout(voiceSendTimer);
        voiceSendTimer = setTimeout(() => submitVoiceTranscript(), 250);
      }
      if (handsFree && !document.hidden && !recognitionBlocked && !busy && !speakingReply && !(window.speechSynthesis && window.speechSynthesis.speaking)) {
        startRecognition();
      } else if (!handsFree && !busy && !voiceFinalTranscript && orbStage.dataset.state === "listening") {
        micLabel.textContent = "Tap to speak";
        setState("idle", "READY", "Your command center. Speak or type to begin.");
      }
    };
  }
  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || busy) return;
    const detectedMemory = extractMemoryFromMessage(text);
    if (detectedMemory) rememberFact(detectedMemory);
    addMessage("user", text);
    messageInput.value = "";
    messageInput.style.height = "auto";
    const explicitTask = text.match(/^(?:task|kaam)\s*:\s*([\s\S]+)$/i);
    if (explicitTask && explicitTask[1].trim()) {
      try {
        if (taskQueue.length >= 30) throw new RangeError("Task Queue full (30/30). Export or remove a task first.");
        const task = createTask(explicitTask[1].trim());
        persistTaskQueue(addTask(taskQueue, task));
        activeTaskFilter = "all"; // Newly added task should always be visible.
        activeDeadlineFilter = "all";
        activeCalendarDay = "";
        activeFocusTaskId = "";
        taskSearchInput.value = "";
        renderTaskQueue();
        wakeActivityBoard();
        if (needsTaskDetails(task.title)) {
          addMessage("agent", "Task save ho gaya. RECENT ACTIVITY mein apne asli kaam ke naam likho, phir plan banega. Main tasks invent nahi karunga.");
          speak("Task save ho gaya. Plan ke liye asli kaam bataiye.");
        } else {
          addMessage("agent", "Task queue mein add kar diya. Ab main safe plan banaunga; connected action approval ke bina execute nahi hoga.");
          speak("Task add kar diya. Main iska plan bana raha hoon.");
        }
        planTask(task.id);
      } catch (error) {
        addMessage("agent", "Task add nahi hua: " + error.message);
      }
      return;
    }
    // Chat must also avoid inventing "three important tasks" when none were supplied.
    if (needsTaskDetails(text)) {
      const clarification = "Aapne abhi apne asli kaam nahi bataye. Kal ke jo kaam hain, unke naam 1, 2, 3 likho. Main bina bataye Project X ya meeting nahi banaunga.";
      addMessage("agent", clarification);
      speak(clarification);
      return;
    }
    if (!endpoint) {
      const notice = "I received your message, but the standalone AI chat backend is not connected yet. Add your private HTTPS chat API in Settings to start chatting.";
      addMessage("agent", notice);
      speak(notice);
      return;
    }
    busy = true;
    $("sendButton").disabled = true;
    setState("thinking", "THINKING", "Working on your request…");
    try {
      const memoryContext = formatMemoryContext(personalMemories);
      const requestHistory = [
        ...(memoryContext ? [{ role: "assistant", content: memoryContext }] : []),
        ...conversationHistory.slice(0, -1).slice(-9)
      ];
      while (requestHistory.length > 10 || requestHistory.reduce((total, item) => total + item.content.length, 0) > 8500) {
        const firstChatIndex = memoryContext ? 1 : 0;
        if (requestHistory.length <= firstChatIndex) break;
        requestHistory.splice(firstChatIndex, 1);
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(ownerToken ? { "Authorization": "Bearer " + ownerToken } : {}) },
        body: JSON.stringify({ message: text, history: requestHistory, sessionId, locale: "hi-IN", client: "jomy-autonomous-agent" })
      });
      if (!response.ok) {
        let detail = "Agent endpoint returned HTTP " + response.status;
        try {
          const errorData = await response.json();
          if (typeof errorData.error === "string") detail = errorData.error;
        } catch (_) {}
        if (response.status === 404) detail = "Agent API route not found. Settings mein poora URL /api/agent/chat par end hona chahiye.";
        throw new Error(detail);
      }
      const data = await response.json();
      const reply = typeof data.reply === "string" ? data.reply : typeof data.message === "string" ? data.message : "";
      if (!reply) throw new Error("The agent response did not include a reply string.");
      addMessage("agent", reply);
      speak(reply);
      setConnection(true, "Connected");
    } catch (error) {
      const notice = "Connection problem: " + error.message + ". No task was confirmed as completed.";
      addMessage("agent", notice);
      speak(notice);
      setState("idle", "CONNECTION ISSUE", "Check your API URL and server status.");
      setConnection(false, "Connection error");
    } finally {
      busy = false;
      $("sendButton").disabled = false;
      if (orbStage.dataset.state === "thinking") setState("idle", handsFree ? "HANDS-FREE ACTIVE" : "READY", handsFree ? "Say JOMY, then give your command." : "Your command center. Speak or type to begin.");
      if (handsFree && !listening && !(window.speechSynthesis && window.speechSynthesis.speaking)) startRecognition();
    }
  }

  for (const button of taskDashboardButtons) {
    button.addEventListener("click", () => {
      activeTaskFilter = button.dataset.taskFilter;
      renderTaskQueue();
    });
  }
  for (const button of deadlineButtons) {
    button.addEventListener("click", () => {
      activeDeadlineFilter = button.dataset.deadlineFilter;
      renderTaskQueue();
    });
  }
  taskSearchInput.addEventListener("input", renderTaskQueue);
  taskSortSelect.addEventListener("change", renderTaskQueue);
  renderTaskTemplates();
  // Today's local date may have changed while Safari was closed/backgrounded.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) renderTaskQueue();
  });
  renderTaskQueue();
  setupRecognition();
  setConnection(false, endpoint ? (ownerToken ? "Endpoint ready · not tested" : "Owner token needed · this browser") : "Not connected");
  handsFreeButton.textContent = handsFree ? "Hands-free: On" : "Hands-free: Off";
  handsFreeButton.setAttribute("aria-pressed", String(handsFree));
  if (handsFree) {
    voiceHint.textContent = "Tap Hands-free once to start. Say “JOMY”, wait for “हाँ, बोलिए”, then speak your command. Keep this page open; iPhone may pause listening in the background or when locked.";
    startRecognition();
  }
  soundButton.setAttribute("aria-pressed", String(soundOn));
  soundButton.textContent = soundOn ? "◖))" : "◖×";
  micButton.addEventListener("click", () => {
    unlockSpeech();
    if (!recognition) return;
    if (handsFree) stopHandsFree();
    else if (listening) stopListening();
    else {
      recognitionBlocked = false;
      recognitionStarting = true;
      try { recognition.start(); } catch (_) { recognitionStarting = false; setState("idle", "MIC PAUSED", "Wait a moment, then tap to retry."); }
    }
  });
  handsFreeButton.addEventListener("click", () => {
    unlockSpeech();
    if (!recognition) return;
    if (handsFree && listening) {
      stopHandsFree();
      return;
    }
    if (handsFree && !listening) {
      recognitionBlocked = false;
      startRecognition();
      return;
    }
    handsFree = true;
    recognitionBlocked = false;
    localStorage.setItem(STORAGE_HANDSFREE, "true");
    waitingForCommand = false;
    handsFreeButton.textContent = "Hands-free: On";
    handsFreeButton.setAttribute("aria-pressed", "true");
    voiceHint.textContent = "Keep JOMY open in the foreground. Say “JOMY”, wait for “हाँ, बोलिए”, then speak. Say “Stop listening” to turn it off. iPhone may pause listening when Safari is backgrounded or the screen locks.";
    startRecognition();
  });
  soundButton.addEventListener("click", () => {
    soundOn = !soundOn;
    if (soundOn) unlockSpeech();
    localStorage.setItem(STORAGE_SOUND, String(soundOn));
    soundButton.setAttribute("aria-pressed", String(soundOn));
    soundButton.textContent = soundOn ? "◖))" : "◖×";
    if (!soundOn && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speakingReply = false;
      if (handsFree) startRecognition();
    }
  });
  renderMemories();
  memoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fact = memoryInput.value.trim();
    if (!fact) return;
    if (rememberFact(fact)) {
      memoryInput.value = "";
    } else {
      memoryInput.setCustomValidity("This fact is already saved or contains sensitive information.");
      memoryInput.reportValidity();
      memoryInput.setCustomValidity("");
    }
  });
  taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = taskInput.value.trim();
    if (!title) return;
    // Explicit button choice: manual READY never calls the owner-token API.
    const manual = event.submitter?.value === "manual";
    try {
      // addTask() trims old tasks when over limit; never silently lose an
      // existing task through the UI in either manual or AI-plan mode.
      if (taskQueue.length >= 30) throw new RangeError("Task Queue full (30/30). Export or remove a task first.");
      const task = manual ? createManualTask(title) : createTask(title);
      const nextQueue = addTask(taskQueue, task);
      // Persist BEFORE mutating the in-memory queue; failed Safari storage
      // must not claim success or drop previously saved tasks.
      localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(nextQueue));
      taskQueue = nextQueue;
      activeTaskFilter = "all"; // Newly added task should always be visible.
      activeDeadlineFilter = "all";
      activeCalendarDay = "";
      activeFocusTaskId = "";
      taskSearchInput.value = "";
      renderTaskQueue();
      taskInput.value = "";
      taskAddStatus.textContent = manual
        ? "Manual READY task saved on this iPhone. Use MARK DONE / REOPEN to update daily progress."
        : "Task saved. JOMY is preparing a plan; no external task has been executed.";
      if (!manual) {
        wakeActivityBoard();
        planTask(task.id);
      }
    } catch (error) {
      taskAddStatus.textContent = "Task not saved: " + error.message;
    }
  });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // iOS Safari needs speech to be primed directly by a user gesture.
    unlockSpeech();
    sendMessage(messageInput.value);
  });
  messageInput.addEventListener("input", () => {
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 110) + "px";
  });
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });
  activityToggle.addEventListener("click", () => {
    const open = activityToggle.getAttribute("aria-expanded") !== "true";
    activityToggle.setAttribute("aria-expanded", String(open));
    messages.hidden = !open;
    taskPanel.hidden = !open;
    $("activityChevron").textContent = open ? "−" : "＋";
  });
  const settingsNote = $("settingsNote");
  const saveEndpointButton = $("saveEndpoint");
  const clearEndpointButton = $("clearEndpoint");
  $("settingsButton").addEventListener("click", () => {
    endpointInput.value = endpoint || DEFAULT_ENDPOINT;
    agentTokenInput.value = ownerToken;
    settingsNote.textContent = ownerToken ? "" : "Preview aur Production ki storage alag hai. Apna existing Owner token yahin enter karo; chat mein share mat karo.";
    if (!settingsDialog.open) {
      if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
      else settingsDialog.setAttribute("open", "");
    }
  });
  saveEndpointButton.addEventListener("click", () => {
    try {
      const normalized = normalizeAgentEndpoint(endpointInput.value);
      const enteredToken = agentTokenInput.value.trim();
      // Keep an already-saved token when the password field is left blank.
      localStorage.setItem(STORAGE_ENDPOINT, normalized);
      if (enteredToken) localStorage.setItem(STORAGE_TOKEN, enteredToken);
      endpoint = normalized;
      ownerToken = enteredToken || localStorage.getItem(STORAGE_TOKEN) || "";
      sessionStorage.removeItem(STORAGE_TOKEN);
      settingsNote.textContent = "Saved on this iPhone. Endpoint abhi test nahi hua; chat mein ek message bhej kar check karo.";
      saveEndpointButton.textContent = "Saved ✓";
      setConnection(false, endpoint ? (ownerToken ? "Endpoint saved · not tested" : "Owner token needed · this browser") : "Not connected");
    } catch (error) {
      settingsNote.textContent = error?.message || "Endpoint save nahi hua. Valid HTTPS URL enter karo.";
      saveEndpointButton.textContent = "Save endpoint";
    }
  });
  endpointInput.addEventListener("input", () => { saveEndpointButton.textContent = "Save endpoint"; });
  agentTokenInput.addEventListener("input", () => { saveEndpointButton.textContent = "Save endpoint"; });
  clearEndpointButton.addEventListener("click", () => {
    try {
      localStorage.removeItem(STORAGE_ENDPOINT);
      localStorage.removeItem(STORAGE_TOKEN);
      sessionStorage.removeItem(STORAGE_TOKEN);
      endpoint = "";
      ownerToken = "";
      endpointInput.value = "";
      agentTokenInput.value = "";
      settingsNote.textContent = "Disconnected on this iPhone.";
      saveEndpointButton.textContent = "Save endpoint";
      setConnection(false, "Not connected");
    } catch (error) {
      settingsNote.textContent = "Browser storage access nahi ho paaya. Safari settings check karo.";
    }
  });

  // iOS Safari may suspend recognition when this PWA is backgrounded.
  // Stop cleanly while hidden and resume only after the page is visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (recognition && listening) {
        try { recognition.stop(); } catch (_) {}
      }
      recognitionStarting = false;
      if (handsFree) {
        voiceHint.textContent = "Safari ne listening pause ki hai. JOMY ko foreground mein lao; mic permission active ho to listening resume hogi.";
        setState("idle", "VOICE PAUSED", "JOMY ko foreground mein rakho for hands-free voice.");
      }
      return;
    }
    if (handsFree && !busy && !speakingReply && !recognitionBlocked) {
      startRecognition();
    }
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  // Only advertise readiness after all main form handlers are attached.
  window.__jomyAppReady = true;
})();
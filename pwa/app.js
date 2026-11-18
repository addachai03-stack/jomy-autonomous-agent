import { parseWakeCommand, discardPendingVoiceCapture, normalizeAgentEndpoint } from "./voice-utils.js";
import { prepareSpeechText } from "./speech-text.js";
import { selectHindiFemaleVoice } from "./speech-voice.js";
import { addMemory, removeMemory, extractMemoryFromMessage, formatMemoryContext } from "./memory-utils.js";
import { createTask, addTask, transitionTask, retryTask, recoverInterruptedTasks, getChecklistProgress, setChecklistStepChecked, summarizeTaskQueue, filterTaskQueue, searchAndSortTaskQueue, getTaskSchedule, setTaskSchedule, TASK_STATES } from "./task-engine.js";
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
  const taskInput = $("taskInput");
  const taskSearchInput = $("taskSearchInput");
  const taskSortSelect = $("taskSortSelect");
  const taskList = $("taskList");
  const memoryForm = $("memoryForm");
  const memoryInput = $("memoryInput");
  const memoryList = $("memoryList");
  const taskCount = $("taskCount");
  const taskDashboard = $("taskDashboard");
  const taskFilterSummary = $("taskFilterSummary");
  const taskDashboardButtons = [...taskDashboard.querySelectorAll("[data-task-filter]")];
  let activeTaskFilter = "all";
  const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1";
  const MEMORY_KEY = "jomy_agent_personal_memory_v1";
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
  function saveTaskQueue() {
    taskQueue = taskQueue.slice(-30);
    try { localStorage.setItem(TASK_QUEUE_KEY, JSON.stringify(taskQueue)); } catch (_) {}
  }
  function updateTask(taskId, updater) {
    taskQueue = taskQueue.map(task => task.id === taskId ? updater(task) : task);
    saveTaskQueue();
    renderTaskQueue();
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
  // Dashboard counts are derived from existing local tasks, never guessed or fetched.
  function renderTaskDashboard() {
    const counts = summarizeTaskQueue(taskQueue);
    for (const button of taskDashboardButtons) {
      const filter = button.dataset.taskFilter;
      button.querySelector(".task-stat-number").textContent = String(counts[filter]);
      button.setAttribute("aria-pressed", String(activeTaskFilter === filter));
    }
    const visibleTasks = filterTaskQueue(taskQueue, activeTaskFilter);
    const names = { pending: "pending / needs attention", in_progress: "in progress", done: "done" };
    const selected = searchAndSortTaskQueue(visibleTasks, taskSearchInput.value, taskSortSelect.value);
    const searchText = taskSearchInput.value.trim();
    const label = activeTaskFilter === "all" ? "tasks" : names[activeTaskFilter] + " tasks";
    taskFilterSummary.textContent = "Showing " + selected.length + " of " + counts.all + " " + label
      + (searchText ? " matching your search" : "") + " · saved on this device.";
    return selected;
  }
  function renderTaskQueue() {
    taskCount.textContent = taskQueue.length + "/30";
    const visibleTasks = renderTaskDashboard();
    taskList.replaceChildren();
    if (!visibleTasks.length) {
      const empty = document.createElement("p");
      empty.className = "task-empty";
      empty.textContent = !taskQueue.length
        ? "No tasks yet. Add a task you want JOMY to organize."
        : taskSearchInput.value.trim()
          ? "No tasks match your search. Try a different name or clear search."
          : "No tasks match this filter. Tap TOTAL to see all tasks.";
      taskList.append(empty);
      return;
    }
    for (const task of visibleTasks) {
      const item = document.createElement("article");
      item.className = "task-item";
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
        taskQueue = taskQueue.filter(entry => entry.id !== task.id);
        saveTaskQueue();
        renderTaskQueue();
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
        const task = createTask(explicitTask[1].trim());
        taskQueue = addTask(taskQueue, task);
        saveTaskQueue();
        activeTaskFilter = "all"; // Newly added task should always be visible.
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
  taskSearchInput.addEventListener("input", renderTaskQueue);
  taskSortSelect.addEventListener("change", renderTaskQueue);
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
    try {
      const task = createTask(title);
      taskQueue = addTask(taskQueue, task);
      saveTaskQueue();
      activeTaskFilter = "all"; // Newly added task should always be visible.
      taskSearchInput.value = "";
      renderTaskQueue();
      taskInput.value = "";
      wakeActivityBoard();
      planTask(task.id);
    } catch (error) {
      addMessage("agent", "Task add nahi hua: " + error.message);
      wakeActivityBoard();
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
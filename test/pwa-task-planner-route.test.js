import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/worker.js", import.meta.url), "utf8");
const planner = app.split("  async function planTask(taskId) {")[1]?.split("  function renderTaskQueue() {")[0] || "";

test("task planner uses the deployed authenticated plan route, not chat", () => {
  assert.ok(planner, "Missing task planner handler");
  assert.match(planner, /const planEndpoint = new URL\(endpoint\)/);
  assert.match(planner, /planEndpoint\.pathname = "\/api\/agent\/plan"/);
  assert.match(planner, /fetch\(planEndpoint\.toString\(\)/);
  assert.match(planner, /"Authorization": "Bearer " \+ ownerToken/);
  assert.match(planner, /body: JSON\.stringify\(\{ task: planningText \}\)/);
  assert.doesNotMatch(planner, /plannerPrompt|client: "jomy-task-planner"/);
});

test("task planner validates structured plan response and never claims execution", () => {
  assert.match(planner, /data\.status !== "planned"/);
  assert.match(planner, /parseTaskPlan\(JSON\.stringify\(data\.plan\), planningText\)/);
  assert.match(planner, /TASK_STATES\.BLOCKED/);
  assert.match(planner, /TASK_STATES\.READY/);
  assert.match(planner, /TASK_STATES\.FAILED/);
  assert.match(worker, /url\.pathname === "\/api\/agent\/plan"/);
  assert.match(worker, /json\(\{ status: "planned", plan, executed: false \}/);
});

test("vague tasks request actual user details before calling the AI", () => {
  assert.match(planner, /needsTaskDetails\(planningText\)/);
  assert.match(planner, /TASK_STATES\.NEEDS_DETAILS/);
  assert.match(app, /detailInput\.maxLength = 4000/);
  assert.match(app, /detailInput\.value\.trim\(\)/);
  assert.match(app, /details: actualText/);
  assert.match(app, /"needs_details", "planning"/);
  assert.match(app, /confirmButton\.textContent = "SAVE & PLAN"/);
});

test("ordinary chat asks for task details rather than calling AI with vague plans", () => {
  assert.match(app, /if \(needsTaskDetails\(text\)\) \{/);
  assert.match(app, /const clarification = "Aapne abhi apne asli kaam nahi bataye/);
  assert.match(app, /addMessage\("agent", clarification\)/);
  assert.match(app, /speak\(clarification\)/);
});

test("specific AI planning failures can use local checklist without masking authorization", () => {
  assert.match(planner, /response\.status === 502 && data\.code === "TASK_PLAN_FAILED"/);
  assert.match(planner, /createLocalTaskOutline\(planningText\)/);
  assert.match(planner, /transitionTask\(task, TASK_STATES\.READY, \{ steps: localPlan\.steps \}\)/);
  assert.match(app, /task\.plan\?\.source === "local"/);
  assert.match(app, /AI planning unavailable/);
});


test("manual task controls are wired to local transitions rather than API actions", () => {
  assert.match(app, /function setManualTaskProgress\(taskId, nextStatus\)/);
  assert.match(app, /updateTask\(taskId, task => transitionTask\(task, nextStatus\)\)/);
  assert.match(app, /\["START", TASK_STATES\.IN_PROGRESS\]/);
  assert.match(app, /\["MARK DONE", TASK_STATES\.DONE\]/);
  assert.match(app, /\["PAUSE", TASK_STATES\.READY\]/);
  assert.match(app, /\["REOPEN", TASK_STATES\.READY\]/);
  assert.match(app, /setManualTaskProgress\(task\.id, nextStatus\)/);
  assert.match(app, /"in_progress", "done", "running"/);
});

test("manual task completion is not represented as external execution", () => {
  assert.match(app, /You marked this done · No external action was executed by JOMY\./);
  assert.match(app, /IN PROGRESS \(MANUAL\)/);
  assert.match(app, /DONE \(MANUAL\)/);
});

test("progress actions render in task cards, NEVER in Personal Memory list", () => {
  const memoryRenderer = app.split("  function renderMemories() {")[1]?.split("  function rememberFact(")[0] || "";
  const taskRenderer = app.split("  function renderTaskQueue() {")[1]?.split("  function wakeActivityBoard() {")[0] || "";
  assert.ok(memoryRenderer.includes("memory-item"), "Memory renderer block could not be located");
  assert.ok(taskRenderer.includes("task-item"), "Task renderer block could not be located");
  assert.doesNotMatch(memoryRenderer, /availableActions|setManualTaskProgress|task\.status|task\.title|actions\.append/);
  assert.match(taskRenderer, /const availableActions = task\.status === TASK_STATES\.READY/);
  assert.match(taskRenderer, /actionButton\.addEventListener\("click", \(\) => setManualTaskProgress\(task\.id, nextStatus\)\)/);
  assert.match(taskRenderer, /item\.append\(details, actions\)/);
});

test("memory saved facts stay independent of manual task state controls", () => {
  const memoryRenderer = app.split("  function renderMemories() {")[1]?.split("  function rememberFact(")[0] || "";
  assert.match(memoryRenderer, /for \(const item of personalMemories\)/);
  assert.match(memoryRenderer, /const remove = document\.createElement\("button"\)/);
  assert.match(memoryRenderer, /personalMemories = removeMemory\(personalMemories, item\.id\)/);
});

test("iPhone task cards leave full width for plan text and place controls below it", () => {
  const styles = readFileSync(new URL("../pwa/styles.css", import.meta.url), "utf8");
  const mobile = styles.split("@media(max-width:640px){").find(section => section.includes(".task-item{flex-direction:column;align-items:stretch")) || "";
  assert.ok(mobile, "Mobile task card override missing");
  assert.match(mobile, /\.task-item\{flex-direction:column;align-items:stretch/);
  assert.match(mobile, /\.task-item > \.task-details\{width:100%;min-width:0/);
  assert.match(mobile, /\.task-actions\{width:100%;max-width:none;justify-content:flex-start/);
  assert.match(mobile, /\.task-remove\{margin-left:auto\}/);
});


test("manual checklist is rendered only in Task Queue cards, not Personal Memory", () => {
  const memorySection = app.split("  function renderMemories() {")[1]?.split("  function rememberFact(")[0] || "";
  const tasksSection = app.split("  function renderTaskQueue() {")[1]?.split("  function wakeActivityBoard() {")[0] || "";
  assert.ok(memorySection.includes("memory-item"), "Memory renderer missing");
  assert.ok(tasksSection.includes("task-item"), "Task renderer missing");
  assert.doesNotMatch(memorySection, /setManualStepProgress|completedStepIndices|getChecklistProgress|task-check-row/);
  assert.match(tasksSection, /getChecklistProgress\(task\)/);
  assert.match(tasksSection, /checkbox\.type = "checkbox"/);
  assert.match(tasksSection, /checkbox\.addEventListener\("change", \(\) => setManualStepProgress\(task\.id, index, checkbox\.checked\)\)/);
  assert.match(tasksSection, /labelText\.textContent = step/);
  assert.match(tasksSection, /"CHECKLIST · " \+ checklist\.done \+ "\/" \+ checklist\.total/);
});

test("checklist changes remain on device and do not make an API request", () => {
  const handler = app.split("  function setManualStepProgress(taskId, stepIndex, checked) {")[1]?.split("  async function planTask(taskId) {")[0] || "";
  assert.ok(handler, "Manual checklist handler missing");
  assert.match(handler, /updateTask\(taskId, item => setChecklistStepChecked\(item, stepIndex, checked\)\)/);
  assert.doesNotMatch(handler, /fetch\(|planTask\(|sendMessage\(/);
  assert.match(app, /"in_progress", "done", "running"/);
  const css = readFileSync(new URL("../pwa/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-check-row\{[^\n]+min-height:44px/);
  assert.match(css, /\.task-progress-meter\{/);
});


test("Task Dashboard status filter cards are real buttons inside Task Queue, never Memory", () => {
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  const taskPanel = html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.match(taskPanel, /id="taskDashboard"/);
  assert.match(taskPanel, /role="group" aria-label="Task dashboard status filters"/);
  for (const name of ["all", "pending", "in_progress", "done"]) {
    assert.match(taskPanel, new RegExp('type="button" class="task-stat" data-task-filter="' + name + '"'));
  }
  assert.match(taskPanel, /id="taskFilterSummary" aria-live="polite"/);
  assert.ok(taskPanel.indexOf('id="taskDashboard"') < taskPanel.indexOf('id="taskForm"'));
});

test("Task Dashboard cards derive counts and filter the rendered task list locally", () => {
  const renderDashboard = app.split("  function renderTaskDashboard() {")[1]?.split("  function renderTaskQueue() {")[0] || "";
  const renderQueue = app.split("  function renderTaskQueue() {")[1]?.split("  function wakeActivityBoard() {")[0] || "";
  assert.ok(renderDashboard && renderQueue, "Dashboard or task renderer missing");
  assert.match(renderDashboard, /const counts = summarizeTaskQueue\(taskQueue\)/);
  assert.match(renderDashboard, /filterTaskQueue\(taskQueue, activeTaskFilter\)/);
  assert.match(renderDashboard, /button\.setAttribute\("aria-pressed", String\(activeTaskFilter === filter\)\)/);
  assert.doesNotMatch(renderDashboard, /fetch\(|localStorage\.setItem/);
  assert.match(renderQueue, /const visibleTasks = renderTaskDashboard\(\)/);
  assert.match(renderQueue, /for \(const task of visibleTasks\)/);
  assert.match(renderQueue, /No tasks match this filter/);
  assert.match(app, /button\.addEventListener\("click", \(\) => \{\s+activeTaskFilter = button\.dataset\.taskFilter;\s+renderTaskQueue\(\)/);
  assert.match(app, /activeTaskFilter = "all"; \/\/ Newly added task should always be visible/);
});

test("Task Dashboard does not alter Personal Memory or old Task Queue storage", () => {
  const memory = app.split("  function renderMemories() {")[1]?.split("  function rememberFact(")[0] || "";
  assert.ok(memory.includes("memory-item"), "Personal Memory renderer missing");
  assert.doesNotMatch(memory, /renderTaskDashboard|activeTaskFilter|taskDashboardButtons/);
  assert.match(app, /const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app, /const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
  const css = readFileSync(new URL("../pwa/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-dashboard\{display:grid/);
  assert.match(css, /\.task-stat\[aria-pressed="true"\]/);
  assert.match(css, /@media\(max-width:640px\)\{\.task-dashboard\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});


test("PWA HTML and JS/CSS cache use the same v56 release on Safari", () => {
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../pwa/sw.js", import.meta.url), "utf8");
  assert.match(html, /href="\/styles\.css\?v=56"/);
  assert.match(html, /src="\/app\.js\?v=56"/);
  assert.match(worker, /const CACHE = "jomy-agent-shell-v56"/);
  assert.match(worker, /"\/styles\.css\?v=56"/);
  assert.match(worker, /"\/app\.js\?v=56"/);
  assert.match(worker, /const response = await fetch\(request\);/);
  assert.match(worker, /await caches\.match\(request, \{ ignoreSearch: true \}\)/);
  assert.match(worker, /key\.startsWith\("jomy-agent-shell-"\) && key !== CACHE/);
  assert.doesNotMatch(worker, /caches\.match\(event\.request\)\.then\(\(cached\) => cached \|\| fetch\(event\.request\)\)/);
});

test("PWA service worker never intercepts foreign origins or non-GETs", () => {
  const worker = readFileSync(new URL("../pwa/sw.js", import.meta.url), "utf8");
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /url\.origin !== self\.location\.origin/);
  assert.match(worker, /request\.mode !== "navigate" && !SHELL_PATHS\.has\(url\.pathname\)/);
  assert.match(worker, /cache\.put\(request, copy\)/);
  assert.match(worker, /return Response\.error\(\)/);
  // No browser-data resets: task and memory keys remain identical.
  assert.match(app, /const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app, /const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
});


test("Task Queue Search/Sort controls are accessible and inside Task Queue only", () => {
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  const taskPanel = html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.match(taskPanel, /id="taskSearchInput" type="search"/);
  assert.match(taskPanel, /id="taskSortSelect" aria-label="Task order"/);
  assert.match(taskPanel, /<option value="newest">Newest first<\/option>/);
  assert.match(taskPanel, /<option value="oldest">Oldest first<\/option>/);
  assert.ok(taskPanel.indexOf('id="taskForm"') < taskPanel.indexOf('id="taskSearchInput"'));
  assert.ok(taskPanel.indexOf('id="taskSearchInput"') < taskPanel.indexOf('id="taskList"'));
});

test("Search/Sort composes with live status filters without changing task storage", () => {
  const dashboard = app.split("  function renderTaskDashboard() {")[1]?.split("  function renderTaskQueue() {")[0] || "";
  assert.match(dashboard, /filterTaskQueue\(taskQueue, activeTaskFilter\)/);
  assert.match(dashboard, /searchAndSortTaskQueue\(visibleTasks, taskSearchInput\.value, taskSortSelect\.value\)/);
  assert.match(dashboard, /matching your search/);
  assert.doesNotMatch(dashboard, /fetch\(|localStorage\.setItem|saveTaskQueue\(/);
  assert.match(app, /taskSearchInput\.addEventListener\("input", renderTaskQueue\)/);
  assert.match(app, /taskSortSelect\.addEventListener\("change", renderTaskQueue\)/);
  assert.match(app, /taskSearchInput\.value = "";/);
  assert.match(app, /No tasks match your search/);
  assert.match(app, /const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app, /const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
});

test("Task Search/Sort inputs fit iPhone and preserve existing dashboard card styling", () => {
  const css = readFileSync(new URL("../pwa/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-browse-controls\{display:grid/);
  assert.match(css, /\.task-browse-controls input,\.task-browse-controls select\{[^\n]*min-height:44px/);
  assert.match(css, /@media\(max-width:480px\)\{\.task-browse-controls\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.task-stat\[aria-pressed="true"\]/);
});


test("Task Queue 2.5 renders owner-only priority and due date controls in task cards", () => {
  const renderer = app.split('  function renderTaskQueue() {')[1]?.split('  function wakeActivityBoard() {')[0] || "";
  assert.ok(renderer, "Task Queue renderer missing");
  assert.ok(renderer.includes('const schedule = getTaskSchedule(task);'));
  assert.ok(renderer.includes('scheduleEditor.className = "task-schedule"'));
  assert.ok(renderer.includes('prioritySelect.className = "task-priority-select"'));
  assert.ok(renderer.includes('dueInput.type = "date"'));
  assert.ok(renderer.includes('dueInput.value = schedule.dueDate'));
  assert.ok(renderer.includes('["none", "Not set"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]'));
  assert.ok(renderer.includes('setManualTaskSchedule(task.id, { priority: prioritySelect.value })'));
  assert.ok(renderer.includes('setManualTaskSchedule(task.id, { dueDate: dueInput.value })'));
  assert.ok(!renderer.includes('localStorage.clear()'));
});

test("Task 2.5 schedule controls are local-only and preserve existing queue keys", () => {
  const handler = app.split('  function setManualTaskSchedule(taskId, changes) {')[1]?.split('  function setManualStepProgress(taskId, stepIndex, checked) {')[0] || "";
  assert.ok(handler, "schedule update handler missing");
  assert.ok(handler.includes('updateTask(taskId, task => setTaskSchedule(task, changes));'));
  assert.doesNotMatch(handler, /fetch\(|planTask\(|sendMessage\(/);
  assert.ok(app.includes('const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1";'));
  assert.ok(app.includes('const MEMORY_KEY = "jomy_agent_personal_memory_v1";'));
  const css = readFileSync(new URL("../pwa/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-schedule\{display:grid/);
  assert.ok(css.includes('min-height:44px'));
  assert.ok(css.includes('@media(max-width:420px){.task-schedule{grid-template-columns:minmax(0,1fr)'));
});


test("Task Queue 2.6 shows real Due Today / Overdue buttons and priority sorting", () => {
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  const panel = html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.ok(panel.includes('id="taskDeadlineViews" role="group"'));
  assert.ok(panel.includes('data-deadline-filter="all" aria-pressed="true"'));
  assert.ok(panel.includes('data-deadline-filter="today" aria-pressed="false"'));
  assert.ok(panel.includes('data-deadline-filter="overdue" aria-pressed="false"'));
  assert.ok(panel.includes('<option value="priority">Priority first</option>'));
  assert.ok(panel.indexOf('id="taskSearchInput"') < panel.indexOf('id="taskDeadlineViews"'));
  assert.ok(panel.indexOf('id="taskDeadlineViews"') < panel.indexOf('id="taskList"'));
});

test("Task Queue 2.6 deadline filter runs alongside status, search and sort, not API", () => {
  const dashboard = app.split("  function renderTaskDashboard() {")[1]?.split("  function renderTaskQueue() {")[0] || "";
  const renderer = app.split("  function renderTaskQueue() {")[1]?.split("  function wakeActivityBoard() {")[0] || "";
  assert.ok(dashboard && renderer);
  assert.match(dashboard, /summarizeTaskDeadlines\(taskQueue, today\)/);
  assert.match(dashboard, /filterTaskDeadlines\(/);
  assert.match(dashboard, /filterTaskQueue\(taskQueue, activeTaskFilter\)/);
  assert.match(dashboard, /searchAndSortTaskQueue\(visibleTasks, taskSearchInput\.value, taskSortSelect\.value\)/);
  assert.match(dashboard, /button\.setAttribute\("aria-pressed", String\(activeDeadlineFilter === filter\)\)/);
  assert.doesNotMatch(dashboard, /fetch\(|saveTaskQueue\(|localStorage\.setItem/);
  assert.match(renderer, /taskDueState\(task, localCalendarDate\(\)\)/);
  assert.match(renderer, /warning\.className = "task-due-alert is-" \+ dueState/);
  assert.match(renderer, /No tasks due in this view/);
  assert.match(app, /deadlineButtons\) \{\s+button\.addEventListener\("click", \(\) => \{\s+activeDeadlineFilter = button\.dataset\.deadlineFilter/);
  assert.match(app, /document\.addEventListener\("visibilitychange"/);
  assert.match(app, /activeDeadlineFilter = "all";/);
  assert.ok(app.includes('const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"'));
  assert.ok(app.includes('const MEMORY_KEY = "jomy_agent_personal_memory_v1"'));
});

test("Task Queue 2.6 deadline controls meet iPhone sizing and remain outside Personal Memory", () => {
  const css = readFileSync(new URL("../pwa/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.task-deadline-views\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.task-deadline-filter\{[^\n]*min-height:44px/);
  assert.match(css, /\.task-deadline-filter\[aria-pressed="true"\]/);
  assert.match(css, /\.task-due-alert\.is-overdue\{/);
  const memory = app.split("  function renderMemories() {")[1]?.split("  function rememberFact(")[0] || "";
  assert.ok(memory.includes("memory-item"));
  assert.doesNotMatch(memory, /deadlineButtons|activeDeadlineFilter|taskDueState/);
});


test("Task Queue 2.7 backup form is collapsed and iPhone accessible", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const taskPanel=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.match(taskPanel, /<details class="task-backup-panel" id="taskBackupPanel">/);
  assert.match(taskPanel, /id="taskBackupExport"/);
  assert.match(taskPanel, /id="taskBackupFile" type="file" accept="\.json,application\/json"/);
  assert.match(taskPanel, /id="taskBackupImport" disabled/);
  assert.match(taskPanel, /id="taskBackupStatus" role="status" aria-live="polite"/);
  assert.ok(taskPanel.indexOf("taskBackupPanel") < taskPanel.indexOf('id="taskForm"'));
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css, /\.task-backup-panel\{/);
  assert.match(css, /\.task-backup-actions button,\.task-backup-upload\{[^\n]*min-height:44px/);
});

test("Task Queue 2.7 import previews safely and requires confirmation before any storage write", () => {
  const backup=app.split("  // Backup is entirely local;")[1]?.split("  function updateTask(taskId, updater) {")[0] || "";
  assert.ok(backup,"Task Queue backup controls missing");
  assert.match(backup,/createTaskQueueBackup\(taskQueue\)/);
  assert.match(backup,/readTaskQueueBackup\(await file\.text\(\)\)/);
  assert.match(backup,/mergeTaskQueueBackup\(taskQueue, incoming\)/);
  assert.match(backup,/mergeTaskQueueBackup\(taskQueue, pendingBackupTasks\)/);
  assert.match(backup,/window\.confirm\(/);
  assert.match(backup,/localStorage\.setItem\(TASK_QUEUE_KEY, JSON\.stringify\(preview\.queue\)\)/);
  assert.match(backup,/taskQueue = preview\.queue/);
  assert.match(backup,/taskBackupImport\.disabled = true/);
  assert.match(backup,/file\.size > 524288/);
  const confirmation=backup.indexOf("window.confirm(");
  const save=backup.indexOf("localStorage.setItem(TASK_QUEUE_KEY");
  assert.ok(save > confirmation,"No restore save before confirmation");
  assert.doesNotMatch(backup,/fetch\(|sendMessage\(|planTask\(|localStorage\.clear\(|removeItem\(/);
  assert.match(app,/const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app,/const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
});


test("Task Queue 2.8 creates private Notes & Tags drawer on each task, never in Memory", () => {
  const renderer=app.split('  function renderTaskQueue() {')[1]?.split('  function wakeActivityBoard() {')[0] || "";
  assert.ok(renderer);
  assert.ok(renderer.includes('const annotation = getTaskAnnotations(task);'));
  assert.ok(renderer.includes('editor.className = "task-notes-panel";'));
  assert.ok(renderer.includes('editorHeading.textContent = "NOTES & TAGS'));
  assert.ok(renderer.includes('noteInput.maxLength = 1000;'));
  assert.ok(renderer.includes('tagsInput.maxLength = 140;'));
  assert.ok(renderer.includes('saveManualTaskAnnotations(task.id, noteInput.value, tagsInput.value)'));
  assert.ok(renderer.includes('badge.textContent = "#" + tag;'));
  assert.ok(renderer.includes('editorTags.append(tagsInput);'));
  const memory=app.split('  function renderMemories() {')[1]?.split('  function rememberFact(')[0] || "";
  assert.ok(memory.includes("memory-item"));
  assert.doesNotMatch(memory,/task-notes-panel|task-tags-input|saveManualTaskAnnotations/);
});

test("Task Queue 2.8 notes save locally, not via network or fake completion", () => {
  const handler=app.split('  function saveManualTaskAnnotations(taskId, note, tags) {')[1]
    ?.split('  // Only the owner changes these manual progress states;')[0] || "";
  assert.ok(handler);
  assert.match(handler,/setTaskAnnotations\(task, \{note, tags\}\)/);
  assert.match(handler,/localStorage\.setItem\(TASK_QUEUE_KEY, JSON\.stringify\(next\)\)/);
  assert.ok(handler.indexOf('localStorage.setItem') < handler.indexOf('taskQueue = next;'));
  assert.match(handler,/Notes and tags saved on this device/);
  assert.doesNotMatch(handler,/fetch\(|planTask\(|sendMessage\(|localStorage\.clear\(/);
  assert.ok(app.includes('const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"'));
  assert.ok(app.includes('const MEMORY_KEY = "jomy_agent_personal_memory_v1"'));
});

test("Task Queue 2.8 private notes editor fits iPhone and presents distinct tags", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-notes-panel\{/);
  assert.match(css,/\.task-tag-list\{display:flex/);
  assert.match(css,/\.task-annotation-save\{[^\n]*min-height:44px/);
  assert.match(css,/\.task-note-input,\.task-tags-input\{[^\n]*min-height:44px/);
});


test("Task Queue 2.9 exposes a collapsed reusable templates section and save buttons", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const queue=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.match(queue, /<details class="task-templates-panel" id="taskTemplatesPanel">/);
  assert.match(queue, /id="taskTemplateCount">0\/10/);
  assert.match(queue, /id="taskTemplateList" class="task-template-list" aria-live="polite"/);
  assert.match(queue, /id="taskTemplateStatus" class="task-template-status" role="status"/);
  assert.ok(queue.indexOf("taskTemplatesPanel") < queue.indexOf('id="taskForm"'));
  assert.match(app, /templateButton\.textContent = "SAVE TEMPLATE"/);
  assert.match(app, /templateButton\.addEventListener\("click", \(\) => saveTaskAsTemplate\(task\.id\)\)/);
});

test("Task Queue 2.9 stores templates separately and USE never calls planning API", () => {
  const handler=app.split("  // Reusable task templates are a separate, explicitly owner-controlled local list.")[1]
    ?.split("  function updateTask(taskId, updater) {")[0] || "";
  assert.ok(handler,"Missing task template UI handler");
  assert.match(handler, /createTaskFromTemplate\(template\)/);
  assert.match(handler, /if \(taskQueue\.length >= 30\)/);
  assert.match(handler, /localStorage\.setItem\(TASK_QUEUE_KEY, JSON\.stringify\(next\)\)/);
  assert.match(handler, /localStorage\.setItem\(TASK_TEMPLATES_KEY, JSON\.stringify\(next\)\)/);
  assert.match(handler, /window\.confirm\("Remove saved template/);
  assert.match(handler, /createTaskTemplate\(task\)/);
  assert.match(handler, /renderTaskTemplates\(\)/);
  assert.doesNotMatch(handler, /planTask\(|fetch\(|sendMessage\(|localStorage\.clear\(|localStorage\.removeItem\(/);
  assert.ok(app.includes('const TASK_TEMPLATES_KEY = "jomy_agent_task_templates_v1"'));
  assert.ok(app.includes('const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"'));
  assert.ok(app.includes('const MEMORY_KEY = "jomy_agent_personal_memory_v1"'));
});

test("Task Queue 2.9 reusable templates have iPhone tap targets", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css, /\.task-templates-panel\{/);
  assert.match(css, /\.task-template-actions button\{[^\n]*min-height:44px/);
  assert.match(css, /@media\(max-width:400px\)\{\.task-template-item/);
});


test("JOMY 3.0 analytics dashboard is collapsed, accessible and separated from personal memory", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const panel=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.ok(panel.includes('<details class="task-insights-panel" id="taskInsightsPanel">'));
  for (const id of ["insightsDone","insightsRate","insightsCreatedToday","insightsDoneToday",
                    "insightsWeek","insightsBars","insightsNote"]) {
    assert.ok(panel.includes('id="' + id + '"'),id + " missing");
  }
  assert.match(panel,/LAST 7 DAYS · DEVICE ONLY/);
  assert.match(panel,/COMPLETION RATE/);
  assert.ok(panel.indexOf("taskInsightsPanel")<panel.indexOf("taskTemplatesPanel"));
  assert.match(panel,/role="img" aria-label="Task creations and manual completions/);
  assert.doesNotMatch(panel,/iframe|<canvas|<script/);
});

test("JOMY 3.0 analytics only reads in-memory tasks with no remote calls or storage writes", () => {
  const render=app.split("  // Read-only, device-local analytics.")[1]
    ?.split("  // Dashboard counts are derived from existing local tasks, never guessed or fetched.")[0] || "";
  assert.ok(render);
  assert.match(render,/summarizeTaskAnalytics\(taskQueue, new Date\(\)\)/);
  assert.match(render,/insightsDone\.textContent = String\(analytics\.done\)/);
  assert.match(render,/insightsRate\.textContent = String\(analytics\.completionRate\) \+ "%"/);
  assert.match(render,/insightsBars\.replaceChildren\(\)/);
  assert.match(render,/Only tasks still saved on this device count/);
  assert.doesNotMatch(render,/fetch\(|sendMessage\(|planTask\(|localStorage\.|sessionStorage\.|Worker|JSON\.stringify\(taskQueue\)/);
  assert.match(app,/function renderTaskQueue\(\) \{\s+taskCount\.textContent = taskQueue\.length \+ "\/30";\s+taskTransferPanel\.hidden = taskQueue\.length !== 0;\s+renderTaskInsights\(\)/);
  assert.match(app,/document\.addEventListener\("visibilitychange", \(\) => \{\s+if \(!document\.hidden\) renderTaskQueue\(\);/);
  assert.match(app,/const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app,/const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
});

test("JOMY 3.0 seven-day analytics are responsive and do not override dashboard filters", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-insights-panel\{/);
  assert.match(css,/\.task-insights-panel summary\{[^\n]*min-height:44px/);
  assert.match(css,/\.task-insights-metrics\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.task-insights-bars\{[^\n]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:380px\)/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(app,/taskDashboardButtons\.querySelector|for \(const button of taskDashboardButtons\)/);
});


test("JOMY 3.1 report exposes accessible 7/30-day select and count-only download", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const panel=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.ok(panel.includes('class="task-report" id="taskReport"'));
  assert.ok(panel.includes('<option value="7">Last 7 days</option>'));
  assert.ok(panel.includes('<option value="30">Last 30 days</option>'));
  for(const id of ["reportRangeSelect","reportCreated","reportDone","reportTopDay","reportExport","reportStatus"]) {
    assert.ok(panel.includes('id="' + id + '"'),id + " must exist");
  }
  assert.ok(panel.includes('id="reportStatus" role="status" aria-live="polite"'));
  assert.ok(panel.includes('No task titles, notes, tags, tokens or private details'));
  assert.ok(panel.indexOf("taskReport") < panel.indexOf("taskBackupPanel"));
});

test("JOMY 3.1 CSV is triggered by an explicit click, no remote calls or task storage writes", () => {
  const src=app.split("  // JOMY 3.1: numeric daily counts only, computed in-browser from saved tasks.")[1]
    ?.split("  // Read-only, device-local analytics.")[0] || "";
  assert.ok(src);
  assert.match(src,/summarizeTaskActivityReport\(taskQueue, days, new Date\(\)\)/);
  assert.match(src,/createTaskActivityCsv\(taskQueue, days, new Date\(\)\)/);
  assert.match(src,/reportRangeSelect.addEventListener\("change", renderTaskReport\)/);
  assert.match(src,/reportExport.addEventListener\("click"/);
  assert.match(src,/link.download = "jomy-productivity-"/);
  assert.match(src,/text\/csv;charset=utf-8/);
  assert.match(src,/reportStatus.textContent = "CSV prepared for download/);
  assert.doesNotMatch(src,/fetch\(|planTask\(|sendMessage\(|localStorage\.|sessionStorage\.|clear\(|removeItem\(/);
  assert.match(app,/function renderTaskInsights\(\) \{\s+renderTaskReport\(\);/);
  assert.ok(app.includes('const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"'));
  assert.ok(app.includes('const MEMORY_KEY = "jomy_agent_personal_memory_v1"'));
});

test("JOMY 3.1 report uses iPhone-friendly 44px controls and does not disturb task dashboard", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-report\{/);
  assert.match(css,/\.task-report-controls select\{[^\n]*min-height:44px/);
  assert.match(css,/\.task-report-download\{[^\n]*min-height:44px/);
  assert.match(css,/@media\(max-width:380px\)\{\.task-report/);
  assert.match(app,/for \(const button of taskDashboardButtons\)/);
});


test("JOMY 3.2 Weekly Goal is inside Productivity Insights and accessible", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const panel=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  for(const id of ["weeklyGoalPanel","weeklyGoalForm","weeklyGoalInput","weeklyGoalPeriod",
    "weeklyGoalProgress","weeklyGoalPercentage","weeklyGoalBar","weeklyGoalFill","weeklyGoalStatus"]) {
    assert.ok(panel.includes('id="' + id + '"'),id+" missing");
  }
  assert.match(panel,/type="number" min="1" max="30" step="1" required/);
  assert.match(panel,/role="progressbar" id="weeklyGoalBar"/);
  assert.match(panel,/role="status" aria-live="polite"/);
  assert.ok(panel.indexOf('id="taskReport"') < panel.indexOf('id="weeklyGoalPanel"'));
  assert.ok(panel.indexOf('id="weeklyGoalPanel"') < panel.indexOf('id="taskBackupPanel"'));
  assert.match(panel,/No reminders or notifications/);
});

test("JOMY 3.2 weekly goal saves only dedicated key, after validation and before success", () => {
  const handler=app.split("  // JOMY 3.2: read-only weekly progress from currently retained local tasks.")[1]
    ?.split("  // JOMY 3.1: numeric daily counts only, computed in-browser from saved tasks.")[0] || "";
  assert.ok(handler,"weekly goal handler missing");
  assert.match(handler,/summarizeWeeklyTaskGoal\(taskQueue, weeklyGoalTarget \?\? 5, new Date\(\)\)/);
  assert.match(handler,/weeklyGoalForm.addEventListener\("submit", event =>/);
  assert.match(handler,/validateWeeklyTaskGoal\(Number\(weeklyGoalInput.value\)\)/);
  assert.match(handler,/localStorage.setItem\(WEEKLY_GOAL_KEY, JSON.stringify\(\{ target \}\)\)/);
  assert.match(handler,/weeklyGoalTarget = target/);
  assert.ok(handler.indexOf('localStorage.setItem(WEEKLY_GOAL_KEY') < handler.indexOf('weeklyGoalTarget = target'));
  assert.doesNotMatch(handler,/fetch\(|planTask\(|sendMessage\(|localStorage\.clear\(|removeItem\(|TASK_QUEUE_KEY|MEMORY_KEY/);
  assert.match(app,/function renderTaskInsights\(\) \{\s+renderTaskReport\(\);\s+renderWeeklyGoal\(\);/);
  assert.match(app,/const WEEKLY_GOAL_KEY = "jomy_agent_weekly_goal_v1"/);
  assert.match(app,/const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app,/const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
});

test("JOMY 3.2 weekly goal progress responds to task updates and small iPhone widths", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-weekly-goal\{/);
  assert.match(css,/\.task-weekly-form input,\.task-weekly-form button\{[^\n]*min-height:44px/);
  assert.match(css,/@media\(max-width:370px\)\{\.task-weekly-goal/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(app,/function renderTaskQueue\(\) \{\s+taskCount.textContent = taskQueue.length \+ "\/30";\s+taskTransferPanel\.hidden = taskQueue\.length !== 0;\s+renderTaskInsights\(\)/);
  assert.match(app,/document.addEventListener\("visibilitychange"/);
});


test("JOMY 3.3 Upcoming Calendar is collapsible and accessible in Task Queue", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const panel=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.match(panel,/<details class="task-calendar-panel" id="taskCalendarPanel">/);
  assert.match(panel,/id="calendarSummary" role="status" aria-live="polite"/);
  assert.match(panel,/id="calendarDays" role="group" aria-label="Filter tasks by due date/);
  assert.match(panel,/id="calendarClear" type="button" disabled>SHOW ALL DATES/);
  assert.ok(panel.indexOf('id="taskFilterSummary"') < panel.indexOf('id="taskCalendarPanel"'));
  assert.ok(panel.indexOf('id="taskCalendarPanel"') < panel.indexOf('id="taskInsightsPanel"'));
  assert.match(panel,/No reminders or automatic execution/);
});

test("JOMY 3.3 calendar composes with status/search filters without changing tasks", () => {
  const calendar = app.split("  // Local-calendar date view: no external requests, no storage writes and no timers.")[1]
    ?.split("  // Dashboard counts are derived from existing local tasks, never guessed or fetched.")[0] || "";
  const dashboard = app.split("  function renderTaskDashboard() {")[1]
    ?.split("  function renderTaskQueue() {")[0] || "";
  assert.ok(calendar && dashboard);
  assert.match(calendar,/summarizeUpcomingCalendar\(taskQueue, new Date\(\)\)/);
  assert.match(calendar,/calendarDays.replaceChildren\(\)/);
  assert.match(calendar,/button.dataset.calendarDate = day.date/);
  assert.match(calendar,/button.setAttribute\("aria-pressed", String\(activeCalendarDay === day.date\)\)/);
  assert.match(calendar,/activeCalendarDay = activeCalendarDay === day.date \? "" : day.date/);
  assert.match(calendar,/calendarClear.addEventListener\("click"/);
  assert.doesNotMatch(calendar,/fetch\(|planTask\(|sendMessage\(|localStorage\.|sessionStorage\.|setTimeout\(/);
  assert.match(dashboard,/getTaskSchedule\(task\).dueDate === activeCalendarDay/);
  assert.match(dashboard,/task.status !== TASK_STATES.DONE && task.status !== TASK_STATES.SUCCEEDED/);
  assert.match(dashboard,/filterTaskQueue\(taskQueue, activeTaskFilter\)/);
  assert.match(dashboard,/searchAndSortTaskQueue\(visibleTasks, taskSearchInput.value, taskSortSelect.value\)/);
  assert.match(app,/function renderTaskQueue\(\) \{\s+taskCount.textContent = taskQueue.length \+ "\/30";\s+taskTransferPanel\.hidden = taskQueue\.length !== 0;\s+renderTaskInsights\(\);\s+renderDailyFocus\(\);\s+renderUpcomingCalendar\(\)/);
  assert.match(app,/activeCalendarDay = "";\s+activeFocusTaskId = "";\s+taskSearchInput.value = "";\s+renderTaskQueue\(\)/);
  assert.match(app,/const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
  assert.match(app,/const MEMORY_KEY = "jomy_agent_personal_memory_v1"/);
});

test("JOMY 3.3 upcoming calendar has tappable iPhone-size day buttons and no input to the Worker", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-calendar-panel\{/);
  assert.match(css,/\.task-calendar-panel summary\{[^\n]*min-height:44px/);
  assert.match(css,/\.task-calendar-reset\{[^\n]*min-height:44px/);
  assert.match(css,/@media\(max-width:390px\)\{\.task-calendar-panel/);
  assert.match(app,/document.addEventListener\("visibilitychange", \(\) => \{\s+if \(!document.hidden\) renderTaskQueue\(\);/);
});


test("JOMY 3.4 Smart Daily Planner is collapsed and accessible in Task Queue", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const queue=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0] || "";
  assert.match(queue,/<details class="task-focus-panel" id="taskFocusPanel">/);
  assert.match(queue,/id="taskFocusSummary" role="status" aria-live="polite"/);
  assert.match(queue,/id="taskFocusList" class="task-focus-list"/);
  assert.match(queue,/id="taskFocusClear" disabled>SHOW ALL TASKS/);
  assert.match(queue,/Suggestions do not execute tasks, send reminders or contact AI/);
  assert.ok(queue.indexOf('id="taskFilterSummary"') < queue.indexOf('id="taskFocusPanel"'));
  assert.ok(queue.indexOf('id="taskFocusPanel"') < queue.indexOf('id="taskCalendarPanel"'));
});

test("JOMY 3.4 focus controls safely filter existing queue without task mutation", () => {
  const focus = app.split("  // JOMY 3.4: a read-only daily shortlist from local tasks. Nothing is executed.")[1]
    ?.split("  // Local-calendar date view: no external requests, no storage writes and no timers.")[0] || "";
  const dashboard=app.split("  function renderTaskDashboard() {")[1]
    ?.split("  function renderTaskQueue() {")[0] || "";
  assert.ok(focus && dashboard,"Missing focus/filter handlers");
  assert.match(focus,/summarizeDailyFocusPlan\(taskQueue, new Date\(\), 5\)/);
  assert.match(focus,/taskFocusList.replaceChildren\(\)/);
  assert.match(focus,/view.setAttribute\("aria-pressed", String\(activeFocusTaskId === item.id\)\)/);
  assert.match(focus,/activeFocusTaskId = activeFocusTaskId === item.id \? "" : item.id/);
  assert.match(focus,/taskFocusClear.addEventListener\("click"/);
  assert.match(focus,/view\.dataset\.focusTaskId = item\.id/);
  assert.match(focus,/selectedCard\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focus,/selectedCard\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(focus,/restoredButton\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app,/item\.dataset\.dailyFocus = "true"/);
  assert.match(app,/item\.tabIndex = -1/);
  const css = readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-item\[data-daily-focus="true"\]:focus\{/);
  assert.match(focus,/heading.textContent = \(index \+ 1\) \+ "\. " \+ item.title/);
  assert.doesNotMatch(focus,/fetch\(|planTask\(|sendMessage\(|localStorage\.|sessionStorage\.|Worker|setTimeout\(/);
  assert.match(dashboard,/!activeFocusTaskId \|\| task.id === activeFocusTaskId/);
  assert.match(dashboard,/getTaskSchedule\(task\).dueDate === activeCalendarDay/);
  assert.match(dashboard,/searchAndSortTaskQueue\(visibleTasks, taskSearchInput.value, taskSortSelect.value\)/);
  assert.match(app,/renderTaskInsights\(\);\s+renderDailyFocus\(\);\s+renderUpcomingCalendar\(\)/);
  assert.match(app,/activeFocusTaskId = "";\s+taskSearchInput.value = "";\s+renderTaskQueue\(\)/);
  assert.ok(app.includes('const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"'));
  assert.ok(app.includes('const MEMORY_KEY = "jomy_agent_personal_memory_v1"'));
});

test("JOMY 3.4 focus cards are iPhone responsive with accessible 44px controls", () => {
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  assert.match(css,/\.task-focus-panel\{/);
  assert.match(css,/\.task-focus-panel summary\{[^\n]*min-height:44px/);
  assert.match(css,/\.task-focus-view,\.task-focus-reset\{[^\n]*min-height:44px/);
  assert.match(css,/@media\(max-width:400px\)\{\.task-focus-panel/);
  assert.match(app,/document.addEventListener\("visibilitychange", \(\) => \{\s+if \(!document.hidden\) renderTaskQueue\(\);/);
});

test("JOMY 3.5 progress is device-only, accessible and connected to manual task changes", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  const queue=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0]||"";
  const render=app.split("  function renderDailyFocus() {")[1]
    ?.split("  // Local-calendar date view: no external requests, no storage writes and no timers.")[0]||"";
  assert.ok(queue && render);
  assert.match(queue,/id="taskFocusProgress" role="progressbar" aria-label="Manual progress today"/);
  assert.match(queue,/id="taskFocusProgressLabel" role="status" aria-live="polite"/);
  assert.match(queue,/id="taskFocusProgressFill" class="task-focus-progress-fill"/);
  assert.match(queue,/not a fixed daily goal/);
  assert.match(render,/summarizeDailyTaskProgress\(taskQueue, new Date\(\)\)/);
  assert.match(render,/taskFocusProgress\.setAttribute\("aria-valuenow", String\(progress.percent\)\)/);
  assert.match(render,/taskFocusProgressFill\.style\.width = progress.percent \+ "%"/);
  assert.match(app,/function setManualTaskProgress\(taskId, nextStatus\)/);
  assert.match(app,/renderDailyFocus\(\)/);
  assert.match(css,/\.task-focus-progress-track\{/);
  assert.doesNotMatch(render,/fetch\(|localStorage\.|sessionStorage\.|setTimeout\(/);
});

test("JOMY 3.5 shows non-destructive old-preview restore guidance only for an empty queue", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  const queue=html.split('id="taskPanel"')[1]?.split('<section class="memory-panel"')[0]||"";
  assert.match(queue,/id="taskTransferPanel" aria-label="Restore tasks from older preview" hidden/);
  assert.match(queue,/https:\/\/890aa584\.jomy-agent-pwa\.pages\.dev/);
  assert.match(queue,/target="_blank" rel="noopener noreferrer"/);
  assert.match(queue,/id="taskTransferChoose" type="button"/);
  assert.match(queue,/Each Preview address has its own private iPhone browser storage/);
  assert.match(app,/taskTransferPanel\.hidden = taskQueue\.length !== 0/);
  assert.match(app,/taskBackupPanel\.open = true;\s+taskBackupFile\.click\(\)/);
  assert.match(app,/mergeTaskQueueBackup\(taskQueue, pendingBackupTasks\)/);
  assert.match(app,/window\.confirm\("Import "/);
  assert.match(css,/\.task-transfer-panel\[hidden\]\{display:none!important\}/);
  assert.match(css,/\.task-transfer-actions a,\.task-transfer-actions button\{[^\n]*min-height:44px/);
  assert.doesNotMatch(queue,/localStorage\.|sessionStorage\.|password|secret/i);
});

test("JOMY manual quick-add is no-token, non-destructive and iPhone accessible", () => {
  const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../pwa/styles.css",import.meta.url),"utf8");
  const form=html.split('<form class="task-form" id="taskForm">')[1]
    ?.split("</form>")[0]||"";
  const submit=app.split('  taskForm.addEventListener("submit", (event) => {')[1]
    ?.split('  chatForm.addEventListener("submit"',1)[0]||"";
  assert.ok(form && submit);
  assert.match(form,/type="submit" name="taskMode" value="manual">SAVE MANUAL/);
  assert.match(form,/type="submit" name="taskMode" value="plan">ADD &amp; PLAN/);
  assert.match(html,/id="taskAddStatus" role="status" aria-live="polite"/);
  assert.match(submit,/event.submitter\?\.value === "manual"/);
  assert.match(submit,/taskQueue.length >= 30/);
  assert.match(submit,/const task = manual \? createManualTask\(title\) : createTask\(title\)/);
  assert.match(submit,/localStorage.setItem\(TASK_QUEUE_KEY, JSON.stringify\(nextQueue\)\);\s+taskQueue = nextQueue/);
  assert.match(submit,/if \(!manual\) \{\s+wakeActivityBoard\(\);\s+planTask\(task.id\)/);
  assert.match(submit,/taskAddStatus.textContent = "Task not saved:/);
  assert.match(css,/\.task-form button\{[^\n]*min-height:44px/);
  assert.match(app,/const TASK_QUEUE_KEY = "jomy_agent_task_queue_v1"/);
});

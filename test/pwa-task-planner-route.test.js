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


test("PWA HTML and JS/CSS cache use the same v44 release on Safari", () => {
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../pwa/sw.js", import.meta.url), "utf8");
  assert.match(html, /href="\/styles\.css\?v=44"/);
  assert.match(html, /src="\/app\.js\?v=44"/);
  assert.match(worker, /const CACHE = "jomy-agent-shell-v44"/);
  assert.match(worker, /"\/styles\.css\?v=44"/);
  assert.match(worker, /"\/app\.js\?v=44"/);
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

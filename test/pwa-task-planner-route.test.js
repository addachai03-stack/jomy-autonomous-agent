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
  const mobile = styles.split("@media(max-width:640px){").at(-1);
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

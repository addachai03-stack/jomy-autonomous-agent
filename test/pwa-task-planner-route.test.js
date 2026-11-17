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

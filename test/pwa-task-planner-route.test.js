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
  assert.match(planner, /const planRequest = buildGroundedTaskRequest\(task\.title, task\.userTaskDetails\)/);
  assert.match(planner, /body: JSON\.stringify\(\{ task: planRequest \}\)/);
  assert.doesNotMatch(planner, /plannerPrompt|client: "jomy-task-planner"/);
});

test("task planner validates structured plan response and never claims execution", () => {
  assert.match(planner, /data\.status !== "planned"/);
  assert.match(planner, /parseTaskPlan\(JSON\.stringify\(data\.plan\), task\.title\)/);
  assert.match(planner, /TASK_STATES\.BLOCKED/);
  assert.match(planner, /TASK_STATES\.READY/);
  assert.match(planner, /TASK_STATES\.FAILED/);
  assert.match(worker, /url\.pathname === "\/api\/agent\/plan"/);
  assert.match(worker, /json\(\{ status: "planned", plan, executed: false \}/);
});

test("vague personal planning waits for real tasks before calling AI", () => {
  assert.match(planner, /needsSpecificTasks\(task\.title\) && !task\.userTaskDetails\?\.trim\(\)/);
  assert.match(planner, /transitionTask\(task, TASK_STATES\.NEEDS_DETAILS\)/);
  assert.match(app, /SAVE TASKS & PLAN/);
  assert.match(app, /task\.status === TASK_STATES\.NEEDS_DETAILS/);
  assert.match(app, /userTaskDetails: actual/);
});

test("general chat requests for personal task plans also ask for real task details", () => {
  assert.match(app, /if \(needsSpecificTasks\(text\)\)/);
  assert.match(app, /Project, client meeting ya deadline khud se nahi banaunga/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TASK_STATES, createTask, addTask, transitionTask, retryTask, recoverInterruptedTasks,
  actionPolicy, createActionProposal
} from "../src/task-engine.js";

test("creates bounded queued tasks", () => {
  const task = createTask("  Plan my day  ", 0);
  assert.equal(task.title, "Plan my day");
  assert.equal(task.status, TASK_STATES.QUEUED);
  assert.equal(task.attempts, 0);
  assert.equal(task.createdAt, new Date(0).toISOString());
});

test("rejects empty or oversized task input", () => {
  assert.throws(() => createTask("  "), /1–4000/);
  assert.throws(() => createTask("x".repeat(4001)), /1–4000/);
});

test("queue is bounded, preserves latest tasks and avoids duplicate IDs", () => {
  const tasks = Array.from({length: 32}, (_, i) => ({id: String(i)}));
  const next = addTask(tasks, {id:"32"});
  assert.equal(next.length, 30);
  assert.equal(next.at(-1).id, "32");
  assert.equal(addTask(next, {id:"32"}).length, 30);
});

test("task lifecycle validates transitions and records execution attempts", () => {
  let task = createTask("Prepare report", 0);
  task = transitionTask(task, TASK_STATES.PLANNING, {steps:["Collect inputs","Draft summary"]}, 1000);
  task = transitionTask(task, TASK_STATES.READY, {}, 2000);
  task = transitionTask(task, TASK_STATES.RUNNING, {}, 3000);
  assert.equal(task.attempts, 1);
  task = transitionTask(task, TASK_STATES.SUCCEEDED, {}, 4000);
  assert.equal(task.status, "succeeded");
  assert.throws(() => transitionTask(task, TASK_STATES.RUNNING), /Invalid task transition/);
});

test("retry is bounded and only allowed from failed or retry_wait", () => {
  let task = createTask("Retry a task", 0);
  task = transitionTask(task, TASK_STATES.PLANNING);
  task = transitionTask(task, TASK_STATES.READY);
  task = transitionTask(task, TASK_STATES.RUNNING);
  task = transitionTask(task, TASK_STATES.FAILED, {error:"temporary failure"});
  task = retryTask(task, 5000);
  assert.equal(task.status, "queued");
  task = transitionTask(task, TASK_STATES.PLANNING);
  task = transitionTask(task, TASK_STATES.READY);
  task = transitionTask(task, TASK_STATES.RUNNING);
  task = transitionTask(task, TASK_STATES.FAILED, {error:"second failure"});
  assert.equal(retryTask(task, 6000).status, "failed");
  assert.throws(() => retryTask(createTask("Not failed")), /Only failed/);
});

test("sensitive action proposals require owner approval and never execute", () => {
  const proposal = createActionProposal("financial.transfer", {amount:100});
  assert.equal(proposal.status, "awaiting_owner_approval");
  assert.equal(proposal.policy.approvalRequired, true);
  assert.equal(proposal.executed, false);
  assert.equal(actionPolicy("mcp.status").classification, "read_only");
  assert.equal(actionPolicy("unknown.action").classification, "unsupported");
});

test("task steps are validated and capped", () => {
  const task = createTask("Steps");
  const planning = transitionTask(task, TASK_STATES.PLANNING);
  assert.throws(() => transitionTask(planning, TASK_STATES.READY, {steps:["x".repeat(241)]}), /Task steps/);
});


test("startup recovery marks interrupted planning, running and retry-wait tasks as failed", () => {
  const queued = createTask("Still queued", 0);
  const planning = { ...createTask("Interrupted planning", 0), status: TASK_STATES.PLANNING };
  const running = { ...createTask("Interrupted action", 0), status: TASK_STATES.RUNNING, attempts: 1 };
  const retryWait = { ...createTask("Interrupted retry", 0), status: TASK_STATES.RETRY_WAIT };
  const approved = { ...createTask("Waiting for owner", 0), status: TASK_STATES.AWAITING_APPROVAL, approvalId: "approval-1" };
  const succeeded = { ...createTask("Already complete", 0), status: TASK_STATES.SUCCEEDED };

  const recovered = recoverInterruptedTasks([queued, planning, running, retryWait, approved, succeeded], 9000);

  assert.equal(recovered[0].status, TASK_STATES.QUEUED);
  assert.equal(recovered[1].status, TASK_STATES.FAILED);
  assert.match(recovered[1].lastError, /while planning/);
  assert.equal(recovered[2].status, TASK_STATES.FAILED);
  assert.equal(recovered[2].attempts, 1);
  assert.match(recovered[2].lastError, /No completion was confirmed/);
  assert.equal(recovered[3].status, TASK_STATES.FAILED);
  assert.equal(recovered[4].status, TASK_STATES.AWAITING_APPROVAL);
  assert.equal(recovered[4].approvalId, "approval-1");
  assert.equal(recovered[5].status, TASK_STATES.SUCCEEDED);
  assert.equal(recovered[1].updatedAt, new Date(9000).toISOString());
});

test("startup recovery safely handles a non-array queue", () => {
  assert.deepEqual(recoverInterruptedTasks(null), []);
});

test("retry clears previous failure after planning succeeds", () => {
  let task = createTask("Plan tomorrow's work", 0);
  task = transitionTask(task, TASK_STATES.PLANNING, {}, 100);
  task = transitionTask(task, TASK_STATES.FAILED, { error: "AI provider returned invalid plan." }, 200);
  assert.match(task.lastError, /invalid plan/);
  task = retryTask(task, 300);
  assert.equal(task.status, TASK_STATES.QUEUED);
  assert.equal(task.lastError, null);
  task = transitionTask(task, TASK_STATES.PLANNING, {}, 400);
  task = transitionTask(task, TASK_STATES.READY, { steps: ["Review priorities"] }, 500);
  assert.equal(task.lastError, null);
  assert.equal(task.steps[0], "Review priorities");
});

test("successful planning clears legacy saved lastError from older builds", () => {
  const task = { ...createTask("Legacy error", 0), status: TASK_STATES.PLANNING, lastError: "Previous failed request." };
  const ready = transitionTask(task, TASK_STATES.READY, { steps: ["Create checklist"] }, 100);
  assert.equal(ready.status, TASK_STATES.READY);
  assert.equal(ready.lastError, null);
});

test("PWA only shows task errors for unresolved states", () => {
  const appSource = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
  assert.match(appSource, /task\.lastError && \[TASK_STATES\.FAILED, TASK_STATES\.RETRY_WAIT, TASK_STATES\.BLOCKED\]\.includes\(task\.status\)/);
});

test("unspecified personal plan waits for real task details without an AI failure", () => {
  const base = createTask("Kal ke 3 important kaam ka plan banao", 0);
  const waiting = transitionTask(base, TASK_STATES.NEEDS_DETAILS, {}, 100);
  assert.equal(waiting.status, "needs_details");
  assert.equal(waiting.attempts, 0);
  assert.equal(waiting.lastError, null);
  const withDetails = transitionTask({
    ...waiting,
    userTaskDetails: "1. Review JOMY\n2. Test APPLIQ"
  }, TASK_STATES.QUEUED, {}, 200);
  assert.match(withDetails.userTaskDetails, /Review JOMY/);
  assert.equal(withDetails.status, TASK_STATES.QUEUED);
  assert.equal(withDetails.attempts, 0);
  assert.equal(transitionTask(withDetails, TASK_STATES.PLANNING).status, TASK_STATES.PLANNING);
});

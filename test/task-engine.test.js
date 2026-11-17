import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TASK_STATES, createTask, addTask, transitionTask, retryTask, recoverInterruptedTasks,
  actionPolicy, createActionProposal, getChecklistProgress, setChecklistStepChecked, summarizeTaskQueue, filterTaskQueue, taskDashboardCategory
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

test("underspecified task waits for details without trying to execute a plan", () => {
  const original = createTask("Kal ke 3 important kaam ka plan banao", 0);
  const waiting = transitionTask(original, TASK_STATES.NEEDS_DETAILS, {}, 1000);
  assert.equal(waiting.status, "needs_details");
  assert.equal(waiting.steps.length, 0);
  assert.equal(waiting.attempts, 0);
  const revised = transitionTask(waiting, TASK_STATES.QUEUED, {}, 2000);
  const planning = transitionTask(revised, TASK_STATES.PLANNING, {}, 3000);
  assert.equal(planning.status, "planning");
  assert.equal(planning.title, original.title);
});


test("manual task progress: ready -> in_progress -> done -> reopened", () => {
  const original = transitionTask(
    createTask("APPLIQ test", 0), TASK_STATES.PLANNING, {}, 1000
  );
  const ready = transitionTask(original, TASK_STATES.READY, {steps:["Verify listing"]}, 2000);
  const started = transitionTask(ready, TASK_STATES.IN_PROGRESS, {}, 3000);
  assert.equal(started.status, "in_progress");
  assert.equal(started.manualStartedAt, new Date(3000).toISOString());
  assert.equal(started.attempts, 0);
  assert.deepEqual(started.steps, ready.steps);
  const finished = transitionTask(started, TASK_STATES.DONE, {}, 4000);
  assert.equal(finished.status, "done");
  assert.equal(finished.manualCompletedAt, new Date(4000).toISOString());
  assert.equal(finished.attempts, 0);
  const reopened = transitionTask(finished, TASK_STATES.READY, {}, 5000);
  assert.equal(reopened.status, "ready");
  assert.equal(reopened.manualCompletedAt, undefined);
  assert.deepEqual(reopened.steps, ready.steps);
});

test("manual in_progress and done tasks survive app refresh", () => {
  const planning = transitionTask(createTask("JOMY test", 0), TASK_STATES.PLANNING, {}, 1000);
  const ready = transitionTask(planning, TASK_STATES.READY, {steps:["Check memory"]}, 2000);
  const inProgress = transitionTask(ready, TASK_STATES.IN_PROGRESS, {}, 3000);
  const done = transitionTask(ready, TASK_STATES.DONE, {}, 4000);
  const loaded = recoverInterruptedTasks(JSON.parse(JSON.stringify([inProgress, done])), 5000);
  assert.equal(loaded[0].status, TASK_STATES.IN_PROGRESS);
  assert.equal(loaded[1].status, TASK_STATES.DONE);
  assert.deepEqual(loaded[0].steps, ["Check memory"]);
  assert.equal(loaded[1].manualCompletedAt, new Date(4000).toISOString());
});

test("pausing a manual task never modifies execution attempts", () => {
  const ready = transitionTask(transitionTask(createTask("Review website", 0), TASK_STATES.PLANNING), TASK_STATES.READY);
  const started = transitionTask(ready, TASK_STATES.IN_PROGRESS);
  const paused = transitionTask(started, TASK_STATES.READY);
  const done = transitionTask(paused, TASK_STATES.DONE);
  assert.equal(paused.status, TASK_STATES.READY);
  assert.equal(done.attempts, 0);
  assert.equal(paused.manualStartedAt, undefined);
});

test("manual progress is unavailable while planning, failed or blocked", () => {
  const queued = createTask("Not planned", 0);
  assert.throws(() => transitionTask(queued, TASK_STATES.DONE), /Invalid task transition/);
  const planning = transitionTask(queued, TASK_STATES.PLANNING);
  assert.throws(() => transitionTask(planning, TASK_STATES.IN_PROGRESS), /Invalid task transition/);
  const failed = transitionTask(planning, TASK_STATES.FAILED, {error:"Provider unavailable"});
  assert.throws(() => transitionTask(failed, TASK_STATES.DONE), /Invalid task transition/);
});


test("manual checklist keeps step identities by index and never completes the task automatically", () => {
  const planning = transitionTask(createTask("Review JOMY features", 0), TASK_STATES.PLANNING, {}, 100);
  const ready = transitionTask(planning, TASK_STATES.READY,
    {steps:["Check memory", "Check voice", "Check memory"]}, 200);
  assert.deepEqual(getChecklistProgress(ready), {done:0,total:3,indices:[]});
  const first = setChecklistStepChecked(ready, 0, true, 300);
  const second = setChecklistStepChecked(first, 2, true, 400);
  const all = setChecklistStepChecked(second, 1, true, 500);
  assert.deepEqual(getChecklistProgress(all), {done:3,total:3,indices:[0,1,2]});
  assert.equal(all.status, TASK_STATES.READY);
  assert.equal(all.attempts, 0);
  assert.equal(all.updatedAt, new Date(500).toISOString());
  assert.equal(all.steps[0], all.steps[2]);
  const reopened = setChecklistStepChecked(all, 0, false, 600);
  assert.deepEqual(getChecklistProgress(reopened), {done:2,total:3,indices:[1,2]});
});

test("checklist progress persists across browser storage serialization and status changes", () => {
  const planning = transitionTask(createTask("APPLIQ checks", 0), TASK_STATES.PLANNING);
  const ready = transitionTask(planning, TASK_STATES.READY, {steps:["Listings", "Upload"]});
  const checked = setChecklistStepChecked(ready, 1, true, 300);
  const started = transitionTask(checked, TASK_STATES.IN_PROGRESS, {}, 400);
  const done = transitionTask(started, TASK_STATES.DONE, {}, 500);
  const reloaded = recoverInterruptedTasks(JSON.parse(JSON.stringify([done])), 600)[0];
  assert.equal(reloaded.status, TASK_STATES.DONE);
  assert.deepEqual(getChecklistProgress(reloaded), {done:1,total:2,indices:[1]});
  const reopened = transitionTask(reloaded, TASK_STATES.READY, {}, 700);
  assert.deepEqual(getChecklistProgress(reopened), {done:1,total:2,indices:[1]});
});

test("existing saved READY tasks without checklist data start with zero checked steps", () => {
  const legacy = { ...createTask("Old task", 0), status:TASK_STATES.READY, steps:["A", "B"] };
  assert.deepEqual(getChecklistProgress(legacy), {done:0,total:2,indices:[]});
  assert.deepEqual(getChecklistProgress({...legacy,completedStepIndices:[1,1,99,-2,"0",NaN,0]}),
    {done:2,total:2,indices:[0,1]});
});

test("new plan steps clear outdated checkbox indexes instead of transferring checkmarks", () => {
  let task = createTask("Two tasks", 0);
  task = transitionTask(task, TASK_STATES.PLANNING);
  task = transitionTask(task, TASK_STATES.READY, {steps:["One", "Two"]});
  task = setChecklistStepChecked(task, 1, true);
  // Regeneration passes details.steps through the normal engine path.
  const replanned = transitionTask({...task,status:TASK_STATES.PLANNING}, TASK_STATES.READY, {steps:["Replacement"]});
  assert.deepEqual(getChecklistProgress(replanned), {done:0,total:1,indices:[]});
});

test("checklist rejects invalid indexes and unplanned or unsafe statuses", () => {
  const queued = createTask("Not planned", 0);
  assert.throws(() => setChecklistStepChecked(queued, 0, true), /Only manually managed/);
  const planning = transitionTask(queued, TASK_STATES.PLANNING);
  const ready = transitionTask(planning, TASK_STATES.READY, {steps:["Safe"]});
  assert.throws(() => setChecklistStepChecked(ready, 1, true), /Invalid checklist step/);
  assert.throws(() => setChecklistStepChecked(ready, -1, true), /Invalid checklist step/);
  assert.throws(() => setChecklistStepChecked(ready, 0.5, true), /Invalid checklist step/);
  assert.throws(() => setChecklistStepChecked(ready, 0, "true"), /Invalid checklist step/);
  assert.throws(() => setChecklistStepChecked({...ready,status:TASK_STATES.BLOCKED}, 0, true), /Only manually managed/);
});


test("task dashboard counts every saved lifecycle state exactly once", () => {
  const tasks = [
    TASK_STATES.QUEUED, TASK_STATES.NEEDS_DETAILS, TASK_STATES.PLANNING,
    TASK_STATES.AWAITING_APPROVAL, TASK_STATES.READY, TASK_STATES.IN_PROGRESS,
    TASK_STATES.DONE, TASK_STATES.RUNNING, TASK_STATES.RETRY_WAIT,
    TASK_STATES.SUCCEEDED, TASK_STATES.FAILED, TASK_STATES.BLOCKED
  ].map((status, index) => ({id: String(index), status, steps:["Example"]}));
  const snapshot = JSON.stringify(tasks);
  assert.deepEqual(summarizeTaskQueue(tasks), {all:12, pending:8, in_progress:2, done:2});
  assert.equal(filterTaskQueue(tasks, "pending").length, 8);
  assert.deepEqual(filterTaskQueue(tasks, "in_progress").map(x => x.status),
    [TASK_STATES.IN_PROGRESS, TASK_STATES.RUNNING]);
  assert.deepEqual(filterTaskQueue(tasks, "done").map(x => x.status),
    [TASK_STATES.DONE, TASK_STATES.SUCCEEDED]);
  assert.equal(filterTaskQueue(tasks, "all").length, 12);
  assert.equal(JSON.stringify(tasks), snapshot, "dashboard helpers must never mutate tasks");
  assert.equal(taskDashboardCategory(TASK_STATES.BLOCKED), "pending");
  assert.equal(taskDashboardCategory(TASK_STATES.FAILED), "pending");
});

test("task dashboard handles empty, broken and unknown filter input safely", () => {
  assert.deepEqual(summarizeTaskQueue([]), {all:0,pending:0,in_progress:0,done:0});
  assert.deepEqual(summarizeTaskQueue(null), {all:0,pending:0,in_progress:0,done:0});
  assert.deepEqual(filterTaskQueue(null, "done"), []);
  assert.deepEqual(filterTaskQueue([{status:"ready"}, null, {}, {status:"done"}], "unknown"), [{status:"ready"}, {status:"done"}]);
});

test("dashboard filtering preserves checklist state across refreshes and manual transitions", () => {
  const planning = transitionTask(createTask("iPhone review", 0), TASK_STATES.PLANNING);
  const ready = transitionTask(planning, TASK_STATES.READY, {steps:["Check homepage", "Check task queue"]});
  const ticked = setChecklistStepChecked(ready, 1, true, 200);
  const started = transitionTask(ticked, TASK_STATES.IN_PROGRESS, {}, 300);
  const persisted = recoverInterruptedTasks(JSON.parse(JSON.stringify([started])), 400);
  assert.deepEqual(summarizeTaskQueue(persisted), {all:1,pending:0,in_progress:1,done:0});
  assert.deepEqual(getChecklistProgress(filterTaskQueue(persisted,"in_progress")[0]), {done:1,total:2,indices:[1]});
  const done = transitionTask(persisted[0], TASK_STATES.DONE, {}, 500);
  assert.deepEqual(summarizeTaskQueue([done]), {all:1,pending:0,in_progress:0,done:1});
  assert.deepEqual(getChecklistProgress(filterTaskQueue([done],"done")[0]), {done:1,total:2,indices:[1]});
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskPlan, needsSpecificTasks, buildGroundedTaskRequest } from "../src/task-planner.js";

test("accepts a bounded plan with ordinary steps", () => {
  const plan = parseTaskPlan(JSON.stringify({
    summary: "Prepare a simple daily plan",
    steps: ["List priorities", "Order by urgency"],
    actionType: "none"
  }), "Plan my day");
  assert.equal(plan.actionType, "none");
  assert.equal(plan.requiresApproval, false);
  assert.equal(plan.steps.length, 2);
});

test("rejects malformed and oversized planner output", () => {
  assert.throws(() => parseTaskPlan("not json", "Task"), /valid JSON/);
  assert.throws(() => parseTaskPlan(JSON.stringify({summary:"",steps:["x"],actionType:"none"}), "Task"), /summary/);
  assert.throws(() => parseTaskPlan(JSON.stringify({summary:"Plan",steps:[],actionType:"none"}), "Task"), /1–8/);
});

test("all external integrations are blocked", () => {
  const raw = JSON.stringify({summary:"External messaging unavailable",steps:["Use the supported app manually"],actionType:"telegram.prepare"});
  assert.equal(parseTaskPlan(raw, "Telegram par bhejo: Namaste").actionType, "unsupported");
  assert.equal(parseTaskPlan(raw, "Write a message").actionType, "unsupported");
});

test("unknown action types are blocked, never promoted to executable actions", () => {
  const plan = parseTaskPlan(JSON.stringify({
    summary:"Do an external action",
    steps:["Check request"],
    actionType:"bank.transfer"
  }), "Transfer money");
  assert.equal(plan.actionType, "unsupported");
  assert.equal(plan.requiresApproval, true);
});


test("generic Hindi, Hinglish and English personal plans require real task details", () => {
  for (const title of [
    "Kal ke 3 important kaam ka plan banao",
    "Aaj ka plan batao",
    "Mujhe kal ke 3 important kaam batao",
    "Plan my day",
    "Plan my three important tasks for tomorrow",
    "आज के 3 जरूरी काम का प्लान बनाओ",
    "कल का प्लान बताओ"
  ]) {
    assert.equal(needsSpecificTasks(title), true, title);
  }
});

test("specific tasks are not incorrectly treated as missing details", () => {
  for (const title of [
    "Review APPLIQ app listing",
    "Create JOMY task report",
    "Kal ke 3 important kaam ka plan banao: 1. JOMY QA; 2. APPLIQ listing",
    "Plan my JOMY dashboard implementation",
    "Kal 10am par JOMY check karna",
    "Schedule my Project X stand-up at 9"
  ]) {
    assert.equal(needsSpecificTasks(title), false, title);
  }
});

test("grounded planning request uses only user-provided task context", () => {
  const prompt = buildGroundedTaskRequest("Kal ke 3 important kaam ka plan banao", "1. JOMY QA\n2. APPLIQ listing");
  assert.match(prompt, /1\. JOMY QA\n2\. APPLIQ listing/);
  assert.match(prompt, /Do not invent named projects, meetings, people/);
  assert.doesNotMatch(prompt, /Project X/);
  assert.throws(() => buildGroundedTaskRequest(""), /title is required/);
});

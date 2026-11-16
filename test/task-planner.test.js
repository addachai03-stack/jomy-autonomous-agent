import test from "node:test";
import assert from "node:assert/strict";
import { parseTaskPlan } from "../src/task-planner.js";

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


import { needsTaskDetails } from "../pwa/task-planner.js";

test("generic requests require user-provided real tasks instead of invented jobs", () => {
  for (const prompt of [
    "Kal ke 3 important kaam ka plan banao",
    "Mujhe kal ke 3 important kaam batao",
    "Plan my day",
    "Plan tomorrow's three important tasks",
    "कल के 3 जरूरी काम का प्लान बनाओ",
    "Kal ka plan banao:"
  ]) {
    assert.equal(needsTaskDetails(prompt), true, prompt);
  }
});

test("specific tasks and user-provided lists can be planned", () => {
  for (const prompt of [
    "APPLIQ app release form test karo",
    "Plan for JOMY iPhone voice playback improvement",
    "Kal ke 3 important kaam: APPLIQ listing, JOMY test, backup",
    "1. APPLIQ listing\n2. JOMY chat check\n3. Check app uploads",
    "JOMY website logo update karo",
    "Kal ke liye ghar ka budget tracker update karo"
  ]) {
    assert.equal(needsTaskDetails(prompt), false, prompt);
  }
});

test("empty task details cannot enter AI planning", () => {
  assert.equal(needsTaskDetails(""), true);
  assert.equal(needsTaskDetails(null), true);
  assert.equal(needsTaskDetails("3 important tasks"), true);
});

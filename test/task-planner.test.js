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


import { needsTaskDetails, createLocalTaskOutline } from "../pwa/task-planner.js";

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

test("malformed AI response fallback copies all three supplied task names verbatim", () => {
  const input = "1. APPLIQ app testing 2. JOMY AI features check 3. Website bugs review";
  const plan = createLocalTaskOutline(input);
  assert.equal(plan.source, "local");
  assert.equal(plan.actionType, "none");
  assert.equal(plan.requiresApproval, false);
  assert.deepEqual(plan.steps, [
    "APPLIQ app testing",
    "JOMY AI features check",
    "Website bugs review"
  ]);
  assert.match(plan.summary, /AI planning unavailable/);
  assert.doesNotMatch(JSON.stringify(plan), /Project X|client meeting|9:00/i);
});

test("fallback preserves newline lists and user-supplied task names", () => {
  const plan = createLocalTaskOutline("1. Update APPLIQ listing\n2. Check JOMY voice\n3. Review website bugs");
  assert.deepEqual(plan.steps, ["Update APPLIQ listing", "Check JOMY voice", "Review website bugs"]);
});

test("fallback refuses vague work and never invents missing task names", () => {
  assert.throws(() => createLocalTaskOutline("Kal ke 3 important kaam ka plan banao"), /real task/);
  assert.throws(() => createLocalTaskOutline(""), /real task/);
});

test("fallback caps the checklist at eight short user-provided steps", () => {
  const input = Array.from({ length: 11 }, (_, i) => (i + 1) + ". " + ("Task " + (i + 1)).padEnd(270, "x")).join("\n");
  const plan = createLocalTaskOutline(input);
  assert.equal(plan.steps.length, 8);
  assert.ok(plan.steps.every(step => step.length <= 240));
  assert.match(plan.summary, /first 8/);
});

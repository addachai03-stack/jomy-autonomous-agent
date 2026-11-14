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

test("Telegram preparation requires explicit Telegram send intent", () => {
  const raw = JSON.stringify({summary:"Prepare message",steps:["Review text"],actionType:"telegram.prepare"});
  assert.equal(parseTaskPlan(raw, "Telegram par bhejo: Namaste").actionType, "telegram.prepare");
  assert.equal(parseTaskPlan(raw, "Write a message").actionType, "unsupported");
  assert.equal(parseTaskPlan(raw, "Telegram status check").actionType, "unsupported");
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

test("Telegram intent must use a supported explicit send command", () => {
  const raw = JSON.stringify({summary:"Prepare message",steps:["Review exact message"],actionType:"telegram.prepare"});
  assert.equal(parseTaskPlan(raw, "Telegram par bhejo: Hello").actionType, "telegram.prepare");
  assert.equal(parseTaskPlan(raw, "Telegram message send this").actionType, "unsupported");
});

import test from "node:test";
import assert from "node:assert/strict";
import { discardPendingVoiceCapture, normalizeAgentEndpoint, parseWakeCommand } from "../pwa/voice-utils.js";

test("stopping hands-free discards a pending transcript and cancels its send timer", () => {
  let cancelled = null;
  const state = discardPendingVoiceCapture(
    { transcript: "हेलो से हो तुम", timer: 123 },
    (timer) => { cancelled = timer; }
  );
  assert.equal(cancelled, 123);
  assert.equal(state.transcript, "");
  assert.equal(state.timer, null);
  assert.equal(state.discardResults, true);
});

test("stopping hands-free safely handles no pending timer", () => {
  const state = discardPendingVoiceCapture({ transcript: "", timer: null }, () => {
    assert.fail("clearTimer should not be called for a null timer");
  });
  assert.equal(state.discardResults, true);
});

test("normalizes a Worker base URL to the chat route", () => {
  assert.equal(
    normalizeAgentEndpoint("https://jomy-autonomous-agent-api.addachai03.workers.dev/"),
    "https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat"
  );
});

test("keeps the exact chat route and trims a trailing slash", () => {
  assert.equal(
    normalizeAgentEndpoint("https://example.workers.dev/api/agent/chat/"),
    "https://example.workers.dev/api/agent/chat"
  );
});

test("rejects unrelated API routes and insecure origins", () => {
  assert.throws(() => normalizeAgentEndpoint("https://example.workers.dev/api/agent/mcp"), /chat URL/);
  assert.throws(() => normalizeAgentEndpoint("http://example.workers.dev"), /HTTPS/);
});

test("wake phrase parser ignores ordinary speech without JOMY", () => {
  assert.equal(parseWakeCommand("हेलो से हो तुम जो चाहते हो तुम"), null);
});

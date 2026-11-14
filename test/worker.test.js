import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

const OWNER_TOKEN = "test-owner-token-that-is-long-enough-for-tests";
const ORIGIN = "https://agent.example.com";

function makeRequest(path, { method = "POST", headers = {}, body } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  return new Request("https://worker.example.com" + path, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body })
  });
}

function makeEnv(overrides = {}) {
  return {
    AGENT_OWNER_TOKEN: OWNER_TOKEN,
    ALLOWED_ORIGIN: ORIGIN,
    AI: {
      async run(model, input) {
        assert.equal(model, "@cf/openai/gpt-oss-20b");
        assert.equal(input.messages.at(-1).role, "user");
        return { response: "Namaste! Main JOMY hoon." };
      }
    },
    ...overrides
  };
}

test("health reports readiness without exposing secrets", async () => {
  const response = await worker.fetch(makeRequest("/health", { method: "GET" }), makeEnv());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, "ready");
  assert.equal(data.aiConfigured, true);
  assert.equal(data.ownerAuthConfigured, true);
  assert.equal(data.originConfigured, true);
  assert.equal("AGENT_OWNER_TOKEN" in data, false);
});

test("health reports missing AI binding and does not claim ready", async () => {
  const response = await worker.fetch(makeRequest("/health", { method: "GET" }), makeEnv({ AI: undefined }));
  const data = await response.json();
  assert.equal(data.aiConfigured, false);
  assert.equal(data.status, "configuration_required");
});

test("preflight accepts the configured origin and HTTPS Pages previews only", async () => {
  for (const origin of [ORIGIN, "https://fix-handsfree-hinglish-wake.jomy-agent-pwa.pages.dev"]) {
    const allowed = await worker.fetch(makeRequest("/api/agent/chat", {
      method: "OPTIONS",
      headers: { Origin: origin }
    }), makeEnv());
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), origin);
  }

  for (const origin of ["https://attacker.example", "http://fix.jomy-agent-pwa.pages.dev", "https://jomy-agent-pwa.pages.dev.attacker.example"]) {
    const denied = await worker.fetch(makeRequest("/api/agent/chat", {
      method: "OPTIONS",
      headers: { Origin: origin }
    }), makeEnv());
    assert.equal(denied.status, 403);
  }
});

test("unknown paths and unsupported methods are rejected", async () => {
  const response = await worker.fetch(makeRequest("/unknown", { method: "GET" }), makeEnv());
  assert.equal(response.status, 404);
});

test("chat requires owner bearer authentication", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv());
  assert.equal(response.status, 401);
});

test("chat accepts the approved preview origin and rejects unrelated origins", async () => {
  const preview = "https://fix-handsfree-hinglish-wake.jomy-agent-pwa.pages.dev";
  const allowed = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Origin: preview, Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv());
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), preview);

  const denied = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Origin: "https://attacker.example", Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv());
  assert.equal(denied.status, 403);
});

test("chat rejects non-JSON content types", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: {
      Authorization: "Bearer " + OWNER_TOKEN,
      "Content-Type": "text/plain"
    },
    body: "message=hello"
  }), makeEnv());
  assert.equal(response.status, 415);
});

test("chat rejects oversized request bodies before parsing", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: "x".repeat(16_385)
  }), makeEnv());
  assert.equal(response.status, 413);
});

test("chat rejects malformed JSON and non-object payloads", async () => {
  for (const body of ["{", "[]", "null"]) {
    const response = await worker.fetch(makeRequest("/api/agent/chat", {
      headers: { Authorization: "Bearer " + OWNER_TOKEN },
      body
    }), makeEnv());
    assert.equal(response.status, 400);
  }
});

test("chat validates message length and empty messages", async () => {
  for (const message of [" ", "x".repeat(4001)]) {
    const response = await worker.fetch(makeRequest("/api/agent/chat", {
      headers: { Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ message })
    }), makeEnv());
    assert.equal(response.status, 400);
  }
});

test("chat returns the model reply and chat-only capability", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: {
      Origin: ORIGIN,
      Authorization: "Bearer " + OWNER_TOKEN
    },
    body: JSON.stringify({ message: "Namaste" })
  }), makeEnv());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  const data = await response.json();
  assert.equal(data.reply, "Namaste! Main JOMY hoon.");
  assert.deepEqual(data.capabilities, ["chat"]);
});

test("chat returns 503 when Workers AI is not configured", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv({ AI: undefined }));
  assert.equal(response.status, 503);
});

test("chat converts model failures to a safe 502 response", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv({ AI: { async run() { throw new Error("private provider detail"); } } }));
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.match(data.error, /No action was performed/);
  assert.doesNotMatch(JSON.stringify(data), /private provider detail/);
});


const MCP_CLIENT_TOKEN = "test-mcp-client-token-long-enough-for-unit-tests";

function withMockMcpFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => { globalThis.fetch = original; };
}

function mockMcpResponse(method, params = {}) {
  if (method === "initialize") {
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "jomy-test", version: "1" } }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "test-session", "MCP-Protocol-Version": "2025-03-26" }
    });
  }
  if (method === "notifications/initialized") return new Response(null, { status: 202 });
  if (method === "tools/call" && params.name === "system_status") {
    return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ status: "online", financialActions: "disabled" }) }] } });
  }
  if (method === "tools/call" && params.name === "telegram_status") {
    return Response.json({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: JSON.stringify({ configured: true, botTokenPresent: true, ownerChatIdPresent: true }) }] } });
  }
  if (method === "tools/call" && params.name === "get_approval_status") {
    return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ id: params.arguments.approvalId, action: "telegram.send_message", status: "pending", createdAt: "2026-11-14T10:00:00.000Z", expiresAt: "2026-11-14T10:05:00.000Z", args: { text: "must not leak" } }) }] } });
  }
  if (method === "tools/call" && params.name === "prepare_action") {
    return Response.json({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ approvalId: "123e4567-e89b-42d3-a456-426614174000", status: "pending_owner_approval", expiresAt: "2026-11-13T17:00:00.000Z" }) }] } });
  }
  if (method === "tools/call") return Response.json({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "unknown tool" }], isError: true } });
  if (method === "DELETE") return new Response(null, { status: 200 });
  throw new Error("Unexpected MCP request: " + method);
}

test("MCP bridge requires the Agent owner token", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/mcp", {
    headers: { Origin: ORIGIN },
    body: JSON.stringify({ action: "status", mcpToken: MCP_CLIENT_TOKEN })
  }), makeEnv());
  assert.equal(response.status, 401);
});

test("MCP bridge rejects missing or short client tokens without contacting MCP", async () => {
  let called = false;
  const restore = withMockMcpFetch(async () => { called = true; throw new Error("must not call"); });
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "status", mcpToken: "short" })
    }), makeEnv());
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { restore(); }
});

test("MCP status bridge negotiates MCP and returns safe integration status", async () => {
  const calls = [];
  const restore = withMockMcpFetch(async (url, options) => {
    const body = options.method === "POST" && options.body ? JSON.parse(options.body) : {};
    calls.push({ method: options.method, rpc: body.method, tool: body.params?.name });
    return mockMcpResponse(options.method === "DELETE" ? "DELETE" : body.method, body.params);
  });
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "status", mcpToken: MCP_CLIENT_TOKEN })
    }), makeEnv());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "connected");
    assert.equal(data.system.status, "online");
    assert.equal(data.telegram.configured, true);
    assert.deepEqual(data.capabilities, ["mcp_status", "telegram_prepare"]);
    assert.ok(calls.some(call => call.tool === "system_status"));
    assert.ok(calls.some(call => call.tool === "telegram_status"));
    assert.ok(calls.some(call => call.method === "DELETE"));
  } finally { restore(); }
});

test("approval status bridge returns only the safe status fields", async () => {
  const calls = [];
  const restore = withMockMcpFetch(async (url, options) => {
    const body = options.method === "POST" && options.body ? JSON.parse(options.body) : {};
    calls.push({ method: options.method, rpc: body.method, tool: body.params?.name, args: body.params?.arguments });
    return mockMcpResponse(options.method === "DELETE" ? "DELETE" : body.method, body.params);
  });
  try {
    const approvalId = "123e4567-e89b-42d3-a456-426614174000";
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "approval_status", mcpToken: MCP_CLIENT_TOKEN, approvalId })
    }), makeEnv());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.approval.id, approvalId);
    assert.equal(data.approval.status, "pending");
    assert.equal(data.approval.action, "telegram.send_message");
    assert.equal("args" in data.approval, false);
    assert.ok(calls.some(call => call.tool === "get_approval_status" && call.args.approvalId === approvalId));
  } finally { restore(); }
});

test("approval status bridge rejects malformed IDs before contacting MCP", async () => {
  let called = false;
  const restore = withMockMcpFetch(async () => { called = true; throw new Error("must not call"); });
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "approval_status", mcpToken: MCP_CLIENT_TOKEN, approvalId: "not-a-uuid" })
    }), makeEnv());
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally { restore(); }
});

test("Telegram bridge only prepares an owner approval and never executes a send", async () => {
  const calls = [];
  const restore = withMockMcpFetch(async (url, options) => {
    const body = options.method === "POST" && options.body ? JSON.parse(options.body) : {};
    calls.push({ method: options.method, rpc: body.method, tool: body.params?.name, args: body.params?.arguments });
    return mockMcpResponse(options.method === "DELETE" ? "DELETE" : body.method, body.params);
  });
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "prepare_telegram", mcpToken: MCP_CLIENT_TOKEN, text: "Hello from JOMY" })
    }), makeEnv());
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.status, "pending_owner_approval");
    assert.equal(data.approvalId, "123e4567-e89b-42d3-a456-426614174000");
    const prepareCall = calls.find(call => call.tool === "prepare_action");
    assert.equal(prepareCall.args.action, "telegram.send_message");
    assert.equal(prepareCall.args.args.text, "Hello from JOMY");
    assert.equal(calls.some(call => call.tool === "approve_and_execute"), false);
  } finally { restore(); }
});


test("MCP bridge returns a safe actionable diagnostic when the Client token is rejected", async () => {
  const restore = withMockMcpFetch(async () => new Response("unauthorized", { status: 401 }));
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "status", mcpToken: MCP_CLIENT_TOKEN })
    }), makeEnv());
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.code, "MCP_AUTH_REJECTED");
    assert.match(data.error, /dedicated Client token/);
    assert.doesNotMatch(JSON.stringify(data), new RegExp(MCP_CLIENT_TOKEN));
  } finally { restore(); }
});

test("MCP bridge hides upstream exception details and never echoes credentials", async () => {
  const privateDetail = "provider-private-detail-" + MCP_CLIENT_TOKEN;
  const restore = withMockMcpFetch(async () => { throw new Error(privateDetail); });
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "status", mcpToken: MCP_CLIENT_TOKEN })
    }), makeEnv());
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.code, "MCP_UPSTREAM_ERROR");
    assert.doesNotMatch(JSON.stringify(data), /provider-private-detail|test-mcp-client-token/);
  } finally { restore(); }
});


test("MCP bridge identifies a missing MCP route separately from authentication failures", async () => {
  const restore = withMockMcpFetch(async () => new Response("not found", { status: 404 }));
  try {
    const response = await worker.fetch(makeRequest("/api/agent/mcp", {
      headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ action: "status", mcpToken: MCP_CLIENT_TOKEN })
    }), makeEnv());
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.code, "MCP_ENDPOINT_MISMATCH");
    assert.match(data.error, /endpoint or HTTP method/);
  } finally { restore(); }
});


test("chat extracts text from supported Workers AI response shapes", async () => {
  const responses = [
    { response: "reply from response" },
    { output_text: "reply from output_text" },
    { output: [{ type: "message", content: [{ type: "output_text", text: "reply from output" }] }] },
    { choices: [{ message: { content: "reply from choices" } }] }
  ];
  for (const result of responses) {
    const response = await worker.fetch(makeRequest("/api/agent/chat", {
      headers: { Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ message: "Hello" })
    }), makeEnv({ AI: { async run() { return result; } } }));
    assert.equal(response.status, 200);
    assert.ok((await response.json()).reply.startsWith("reply from"));
  }
});

test("chat returns a safe diagnostic when the model returns no readable text", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv({ AI: { async run() { return { output: [] }; } } }));
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.code, "AI_EMPTY_RESPONSE");
  assert.match(data.error, /No action was performed/);
});

test("chat classifies AI rate limits without exposing provider details", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv({ AI: { async run() { const error = new Error("private provider detail"); error.status = 429; throw error; } } }));
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.code, "AI_RATE_LIMITED");
  assert.match(data.error, /rate-limited/);
  assert.doesNotMatch(JSON.stringify(data), /private provider detail/);
});


test("task planning requires owner authentication and validates task input", async () => {
  const unauthenticated = await worker.fetch(makeRequest("/api/agent/plan", {
    body: JSON.stringify({ task: "Plan my day" })
  }), makeEnv());
  assert.equal(unauthenticated.status, 401);

  for (const task of [" ", "x".repeat(4001)]) {
    const invalid = await worker.fetch(makeRequest("/api/agent/plan", {
      headers: { Authorization: "Bearer " + OWNER_TOKEN },
      body: JSON.stringify({ task })
    }), makeEnv());
    assert.equal(invalid.status, 400);
  }
});

test("task planner returns validated steps and never claims execution", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/plan", {
    headers: { Origin: ORIGIN, Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ task: "Plan my day" })
  }), makeEnv({
    AI: {
      async run(model, input) {
        assert.equal(model, "@cf/openai/gpt-oss-20b");
        assert.match(input.messages[0].content, /Return ONLY one JSON object/);
        return { response: JSON.stringify({
          summary: "Make a practical daily plan",
          steps: ["List priorities", "Order tasks by urgency"],
          actionType: "none"
        }) };
      }
    }
  }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.status, "planned");
  assert.equal(data.executed, false);
  assert.deepEqual(data.plan.steps, ["List priorities", "Order tasks by urgency"]);
  assert.equal(data.plan.actionType, "none");
});

test("task planner gates Telegram preparation and blocks unknown external actions", async () => {
  const telegram = await worker.fetch(makeRequest("/api/agent/plan", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ task: "Telegram par bhejo: Namaste" })
  }), makeEnv({
    AI: { async run() { return { response: JSON.stringify({
      summary: "Prepare Telegram message",
      steps: ["Review the exact message"],
      actionType: "telegram.prepare"
    }) }; } }
  }));
  const telegramData = await telegram.json();
  assert.equal(telegramData.plan.actionType, "telegram.prepare");
  assert.equal(telegramData.plan.requiresApproval, true);
  assert.equal(telegramData.executed, false);

  const unsupported = await worker.fetch(makeRequest("/api/agent/plan", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ task: "Transfer money to my friend" })
  }), makeEnv({
    AI: { async run() { return { response: JSON.stringify({
      summary: "Review transfer request",
      steps: ["Verify recipient details"],
      actionType: "financial.transfer"
    }) }; } }
  }));
  const unsupportedData = await unsupported.json();
  assert.equal(unsupportedData.plan.actionType, "unsupported");
  assert.equal(unsupportedData.plan.requiresApproval, true);
});

test("task planner rejects malformed model output without performing actions", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/plan", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ task: "Plan a project" })
  }), makeEnv({ AI: { async run() { return { response: "not json" }; } } }));
  assert.equal(response.status, 502);
  const data = await response.json();
  assert.equal(data.code, "TASK_PLAN_FAILED");
  assert.match(data.error, /No action was performed/);
});

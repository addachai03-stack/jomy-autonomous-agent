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


test("MCP bridge route is no longer exposed by the Agent Worker", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/mcp", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ action: "status", mcpToken: "unused" })
  }), makeEnv());
  assert.equal(response.status, 404);
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

test("task planner blocks external integrations and financial actions", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/plan", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({ task: "Send a Telegram message" })
  }), makeEnv({
    AI: { async run() { return { response: JSON.stringify({
      summary: "External messaging is unavailable",
      steps: ["Use a supported messaging app manually"],
      actionType: "unsupported"
    }) }; } }
  }));
  const data = await response.json();
  assert.equal(data.plan.actionType, "unsupported");
  assert.equal(data.plan.requiresApproval, true);
  assert.equal(data.executed, false);
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


test("chat uses a focused Hindi/Hinglish assistant prompt and forwards validated history in order", async () => {
  let captured;
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: { Authorization: "Bearer " + OWNER_TOKEN },
    body: JSON.stringify({
      message: "Ab agla step kya hai?",
      history: [
        { role: "user", content: "Mujhe app banana hai." },
        { role: "assistant", content: "Pehle requirements clear karte hain." }
      ]
    })
  }), makeEnv({
    AI: {
      async run(model, input) {
        captured = input;
        return { response: "Pehle text chat test karte hain." };
      }
    }
  }));
  assert.equal(response.status, 200);
  assert.equal(captured.messages[0].role, "system");
  assert.match(captured.messages[0].content, /natural Hinglish/);
  assert.match(captured.messages[0].content, /Never invent remembered facts/);
  assert.deepEqual(captured.messages.slice(1).map(item => [item.role, item.content]), [
    ["user", "Mujhe app banana hai."],
    ["assistant", "Pehle requirements clear karte hain."],
    ["user", "Ab agla step kya hai?"]
  ]);
  assert.equal(captured.max_tokens, 450);
  assert.equal(captured.temperature, 0.25);
});

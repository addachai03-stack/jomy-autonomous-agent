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
        assert.equal(model, "@cf/meta/llama-3.1-8b-instruct");
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

test("preflight accepts only the configured origin", async () => {
  const allowed = await worker.fetch(makeRequest("/api/agent/chat", {
    method: "OPTIONS",
    headers: { Origin: ORIGIN }
  }), makeEnv());
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);

  const denied = await worker.fetch(makeRequest("/api/agent/chat", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" }
  }), makeEnv());
  assert.equal(denied.status, 403);
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

test("chat rejects unapproved browser origins", async () => {
  const response = await worker.fetch(makeRequest("/api/agent/chat", {
    headers: {
      Origin: "https://attacker.example",
      Authorization: "Bearer " + OWNER_TOKEN
    },
    body: JSON.stringify({ message: "Hello" })
  }), makeEnv());
  assert.equal(response.status, 403);
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

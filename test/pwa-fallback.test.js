import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const chatFallback = inlineScripts.find(source => source.includes("Keep basic chat usable when"));

function makeNode(id) {
  return {
    id, listeners: {}, children: [], className: "", textContent: "",
    value: "", hidden: true, disabled: false, attrs: {}, scrollHeight: 0, scrollTop: 0,
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this.attrs[name] = value; },
    append(...nodes) { this.children.push(...nodes); },
    remove() { this.removed = true; },
    querySelectorAll() { return this.children.filter(node => node.className.startsWith("message ")); }
  };
}

function mount({ token = "test-owner-token", ready = false, response = { reply: "JOMY replied" } } = {}) {
  const ids = new Map();
  const document = {
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, makeNode(id));
      return ids.get(id);
    },
    createElement(tag) { return makeNode(tag); }
  };
  const store = new Map();
  if (token) store.set("jomy_agent_owner_token_v1", token);
  const localStorage = { getItem(key) { return store.has(key) ? store.get(key) : null; } };
  const sessionStorage = { getItem() { return null; } };
  const window = { __jomyAppReady: ready };
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => response };
  };
  vm.runInNewContext(chatFallback, { document, window, localStorage, sessionStorage, fetch, Date });
  return { ids, window, requests };
}

test("fallback keeps Send from refreshing and calls the real Agent API", async () => {
  assert.ok(chatFallback, "Fallback script must exist");
  const { ids, requests } = mount();
  ids.get("messageInput").value = "Hello JOMY";
  let prevented = false;
  await ids.get("chatForm").listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-owner-token");
  assert.equal(JSON.parse(requests[0].options.body).message, "Hello JOMY");
  assert.equal(ids.get("messages").children.length, 2);
  assert.equal(ids.get("messages").children[1].children[1].textContent, "JOMY replied");
  assert.equal(ids.get("messages").hidden, false);
});

test("fallback yields to the main application's submit handler once ready", async () => {
  const { ids, requests } = mount({ ready: true });
  ids.get("messageInput").value = "Hello";
  let prevented = false;
  await ids.get("chatForm").listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(requests.length, 0);
});

test("fallback never sends messages without an Owner token", async () => {
  const { ids, requests } = mount({ token: "" });
  ids.get("messageInput").value = "Hello";
  let prevented = false;
  await ids.get("chatForm").listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(requests.length, 0);
  assert.match(ids.get("messages").children[0].children[1].textContent, /Owner token/);
});

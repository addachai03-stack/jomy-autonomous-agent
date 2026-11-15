import test from "node:test";
import assert from "node:assert/strict";
import { addMemory, extractMemoryFromMessage, formatMemoryContext, normalizeMemoryFact, removeMemory } from "../pwa/memory-utils.js";

test("captures explicit Hindi and English name introductions", () => {
  assert.equal(extractMemoryFromMessage("Mera naam Rahul hai"), "User's name is Rahul");
  assert.equal(extractMemoryFromMessage("My name is Rahul."), "User's name is Rahul");
});

test("captures only explicit remember requests", () => {
  assert.equal(extractMemoryFromMessage("Yaad rakho mujhe Hinglish pasand hai"), "mujhe Hinglish pasand hai");
  assert.equal(extractMemoryFromMessage("I like Hinglish"), "");
});

test("rejects secrets and sensitive credential-like facts", () => {
  assert.equal(normalizeMemoryFact("My password is abc123"), "");
  assert.equal(normalizeMemoryFact("OTP 123456"), "");
  assert.equal(normalizeMemoryFact("I prefer Hindi"), "I prefer Hindi");
});

test("deduplicates and caps memory at fifteen facts", () => {
  let list = [];
  for (let i = 0; i < 16; i++) list = addMemory(list, "Fact " + i, i + 1);
  assert.equal(list.length, 15);
  assert.equal(list[0].fact, "Fact 1");
  assert.equal(addMemory(list, "Fact 15", 99).length, 15);
});

test("removes a fact and formats local context", () => {
  const list = addMemory([], "User's name is Rahul", 1);
  assert.match(formatMemoryContext(list), /Rahul/);
  assert.equal(removeMemory(list, list[0].id).length, 0);
  assert.equal(formatMemoryContext([]), "");
});

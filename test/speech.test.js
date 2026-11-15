import test from "node:test";
import assert from "node:assert/strict";
import { prepareSpeechText } from "../speech-text.js";

test("speech output removes punctuation, symbols and emoji but keeps useful words and numbers", () => {
  const spoken = prepareSpeechText('Hello!? — JOMY :) 😀 #529300282611, balance ₹500.');
  assert.equal(spoken, "Hello जोमी 529300282611 balance 500");
});

test("speech output reads Hindi naturally and strips decorative emoji", () => {
  const spoken = prepareSpeechText('नमस्ते JOMY!!! 😊 आपका काम हो गया।');
  assert.equal(spoken, "नमस्ते जोमी आपका काम हो गया");
});

test("Roman Hindi Aap is converted to Devanagari instead of being spelled as letters", () => {
  assert.equal(prepareSpeechText('Aap ko kya chahiye?'), "आप ko kya chahiye");
  assert.equal(prepareSpeechText('aap mere dost ho'), "आप mere dost ho");
});

test("emoji sequences including flags, skin tones and keycaps are fully removed", () => {
  assert.equal(prepareSpeechText('Hello 👨🏽‍💻 🇮🇳 1️⃣ 👍🏽 there'), "Hello there");
});

test("speech output handles markdown and links without reading formatting", () => {
  const spoken = prepareSpeechText('**JOMY** ने [यहाँ](https://example.com) बताया।');
  assert.equal(spoken, "जोमी ने यहाँ बताया");
});

test("empty symbol-only replies do not create spoken noise", () => {
  assert.equal(prepareSpeechText('!?— 😀 # @'), "");
});

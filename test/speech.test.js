import test from "node:test";
import assert from "node:assert/strict";
import { prepareSpeechText } from "../speech-text.js";
import { selectHindiFemaleVoice } from "../speech-voice.js";

test("speech output keeps natural pause punctuation and removes symbols and emoji", () => {
  const spoken = prepareSpeechText('Hello!? — JOMY :) 😀 #529300282611, balance ₹500.');
  assert.equal(spoken, "Hello! जोमी 529300282611, balance 500.");
});

test("speech output reads Hindi naturally and strips decorative emoji", () => {
  const spoken = prepareSpeechText('नमस्ते JOMY!!! 😊 आपका काम हो गया।');
  assert.equal(spoken, "नमस्ते जोमी! आपका काम हो गया।");
});

test("Roman Hindi Aap is converted to Devanagari instead of being spelled as letters", () => {
  assert.equal(prepareSpeechText('Aap ko kya chahiye?'), "आप को क्या चाहिए?");
  assert.equal(prepareSpeechText('aap mere dost ho'), "आप मेरे दोस्त हो");
});

test("emoji sequences including flags, skin tones and keycaps are fully removed", () => {
  assert.equal(prepareSpeechText('Hello 👨🏽‍💻 🇮🇳 1️⃣ 👍🏽 there'), "Hello there");
});

test("speech allowlist strips emoji and symbols while preserving words and numbers", () => {
  assert.equal(prepareSpeechText('Hi 🙂 🫠 🫨 🫩 🪾 🫆 ❤️ ™️ ©️ 🏳️‍🌈 2026 and ₹500'), "Hi 2026 and 500");
});

test("the reported emoji cluster stays visible in chat but is absent from speech text", () => {
  assert.equal(prepareSpeechText('Namaste JOMY 😊🔥❤️, mujhe batao aaj tum kaise ho?'), "नमस्ते जोमी, मुझे बताओ आज तुम कैसे हो?");
});

test("speech allowlist preserves Hindi combining marks, other scripts and digits", () => {
  assert.equal(prepareSpeechText('नमस्ते दुनिया १२३ العربية שלום 2026'), "नमस्ते दुनिया १२३ العربية שלום 2026");
});

test("speech output handles markdown and links without reading formatting", () => {
  const spoken = prepareSpeechText('**JOMY** ने [यहाँ](https://example.com) बताया।');
  assert.equal(spoken, "जोमी ने यहाँ बताया।");
});

test("empty symbol-only replies do not create spoken noise", () => {
  assert.equal(prepareSpeechText('!?— 😀 # @'), "");
});

import { readFileSync } from "node:fs";

test("production PWA routes every spoken reply through the sanitizer", () => {
  const source = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
  assert.match(source, /import \{ prepareSpeechText \} from "\.\/speech-text\.js";/);
  assert.match(source, /const speechText = prepareSpeechText\(text\);/);
  assert.match(source, /new SpeechSynthesisUtterance\(speechText\)/);
  assert.match(source, /utterance\.rate = 0\.9;/);
  assert.match(source, /selectHindiFemaleVoice\(synth\.getVoices\(\)\)/);
  assert.doesNotMatch(source, /utterance\.rate = 0\.92;/);
  assert.match(source, /utterance\.pitch = 1\.04;/);
  assert.match(source, /utterance\.volume = 1;/);
  assert.doesNotMatch(source, /new SpeechSynthesisUtterance\(text\)/);
});

test("production service worker precaches the speech sanitizer with a new cache version", () => {
  const source = readFileSync(new URL("../pwa/sw.js", import.meta.url), "utf8");
  assert.match(source, /jomy-agent-shell-v56/);
  assert.match(source, /"\/speech-text\.js"/);
  assert.match(source, /"\/speech-voice\.js"/);
});

test("Hindi female voice selector prefers known Indian female voice names", () => {
  const voices = [
    { name: "Google Hindi", lang: "hi-IN", localService: true },
    { name: "Lekha", lang: "hi-IN", localService: true },
    { name: "Ava", lang: "en-US", localService: true }
  ];
  assert.equal(selectHindiFemaleVoice(voices).name, "Lekha");
});

test("PWA explains that Preview needs its own locally saved owner token", () => {
  const source = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
  assert.match(source, /Owner token needed · this browser/);
  assert.match(source, /Preview aur Production ki storage alag hai/);
  assert.match(source, /chat mein share mat karo/);
});

test("Hindi voice selector falls back to an available Hindi voice", () => {
  const voices = [{ name: "Hindi Voice", lang: "hi-IN", localService: true }];
  assert.equal(selectHindiFemaleVoice(voices).name, "Hindi Voice");
});


test("endpoint settings save and disconnect handlers are bound directly in the main app module", () => {
  const source = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
  assert.match(source, /saveEndpointButton\.addEventListener\("click"/);
  assert.match(source, /normalizeAgentEndpoint\(endpointInput\.value\)/);
  assert.match(source, /localStorage\.setItem\(STORAGE_ENDPOINT, normalized\)/);
  assert.match(source, /clearEndpointButton\.addEventListener\("click"/);
  assert.match(source, /Preview aur Production ki storage alag hai/);
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /endpoint-settings\.js/);
});

test("service worker cache is bumped after consolidating endpoint settings", () => {
  const source = readFileSync(new URL("../pwa/sw.js", import.meta.url), "utf8");
  assert.match(source, /jomy-agent-shell-v56/);
  assert.doesNotMatch(source, /endpoint-settings\.js/);
});

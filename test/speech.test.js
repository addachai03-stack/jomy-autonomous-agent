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
  assert.match(source, /jomy-agent-shell-v62/);
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
  assert.match(source, /jomy-agent-shell-v62/);
  assert.doesNotMatch(source, /endpoint-settings\.js/);
});


import { testAgentConnection } from "../pwa/voice-utils.js";

test("connection diagnostic makes no request without credentials", async () => {
  const result=await testAgentConnection("https://example.test/api/agent/chat","",()=>{throw Error("must not call fetch")});
  assert.equal(result.ok,false);
  assert.match(result.message,/Owner token needed/);
});

test("connection diagnostic sends a single minimal authenticated test, without history or redirects", async () => {
  let calls=0;
  const result=await testAgentConnection("https://example.test/api/agent/chat","sample-only",async(url,opts)=>{
    calls++;
    assert.equal(url,"https://example.test/api/agent/chat");
    assert.equal(opts.headers.Authorization,"Bearer sample-only");
    assert.equal(opts.redirect,"error");
    const payload=JSON.parse(opts.body);
    assert.deepEqual(payload.history,[]);
    assert.deepEqual(Object.keys(payload).sort(),["client","history","locale","message"]);
    return new Response(JSON.stringify({reply:"OK"}),{status:200});
  });
  assert.equal(calls,1);
  assert.equal(result.ok,true);
});

test("connection diagnostic classifies rejected auth, provider limits and malformed replies", async () => {
  for(const [status,data,match] of [
    [401,{},/authentication rejected/],
    [502,{code:"AI_ALLOCATION_OR_BILLING"},/allocation or billing/],
    [200,{reply:" "},/no readable AI reply/]
  ]){
    const result=await testAgentConnection("https://example.test","sample-only",async()=>new Response(JSON.stringify(data),{status}));
    assert.equal(result.ok,false);
    assert.match(result.message,match);
  }
  const result=await testAgentConnection("https://example.test","sample-only",async()=>{throw Error("private network detail")});
  assert.equal(result.ok,false);
  assert.match(result.message,/Cannot reach AI API/);
  assert.doesNotMatch(result.message,/private network detail/);
});

test("connection diagnostic is explicitly user initiated in settings", () => {
  const source = readFileSync(new URL("../pwa/app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../pwa/index.html", import.meta.url), "utf8");
  assert.match(html,/id="testConnection" type="button"/);
  assert.match(source,/testConnectionButton.addEventListener\("click", async/);
  assert.match(source,/await testAgentConnection\(endpoint, ownerToken\)/);
  assert.match(source,/revision !== connectionRevision/);
  assert.match(source,/enteredEndpoint !== endpoint/);
});


test("voice starts only after an explicit gesture and stops safely when hidden", () => {
  const source=readFileSync(new URL("../pwa/app.js",import.meta.url),"utf8");
  assert.match(source,/let handsFree = false;/);
  assert.match(source,/if \(handsFree\) \{\s+stopHandsFree\(\);\s+return;/);
  assert.match(source,/discardVoiceResults = discardVoiceResults \|\| Boolean\(recognition && \(listening \|\| recognitionStarting\)\)/);
  assert.match(source,/recognition.abort\(\)/);
  assert.match(source,/if \(discardVoiceResults \|\| document.hidden \|\| busy \|\| speakingReply\) return/);
  assert.match(source,/if \(document.hidden && \(handsFree \|\| listening \|\| recognitionStarting \|\| voiceSendTimer !== null\)\) \{\s+stopHandsFree\(\)/);
  assert.match(source,/handsFreeButton.textContent = recognition \? "Hands-free: Off" : "Voice unavailable"/);
});


import { requestAgentJson } from "../pwa/voice-utils.js";
test("chat and plan requests block redirects and parse bounded JSON", async () => {
  const result=await requestAgentJson("https://example.test/api/agent/chat",{method:"POST"},async(url,options)=>{
    assert.equal(options.redirect,"error");
    assert.equal(options.cache,"no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({reply:"OK"}),{status:200});
  },200);
  assert.equal(result.data.reply,"OK");
  assert.equal(result.response.status,200);
});
test("AI request deadline aborts a hung fetch or response body",async()=>{
  for(const bodyHang of [false,true]){
    let signal;
    const never=new Promise(()=>{});
    await assert.rejects(requestAgentJson("https://example.test",{method:"POST"},async(url,opts)=>{
      signal=opts.signal;
      return bodyHang ? {ok:true,json:()=>never} : await never;
    },15),/timed out/);
    assert.equal(signal.aborted,true);
  }
});
test("invalid JSON replies fail and non-JSON HTTP errors retain status",async()=>{
  await assert.rejects(requestAgentJson("https://example.test",{},async()=>new Response("bad",{status:200}),200),/not valid JSON/);
  const x=await requestAgentJson("https://example.test",{},async()=>new Response("bad",{status:502}),200);
  assert.equal(x.response.status,502);
  assert.deepEqual(x.data,{});
});


test("voice reply waits for recognition onend before a new hands-free session", () => {
  const source=readFileSync(new URL("../pwa/app.js",import.meta.url),"utf8");
  const handler=source.split("function endRecognitionForReply() {")[1]?.split("function speak(text) {")[0]||"";
  assert.match(handler,/discardVoiceResults = true;\s+listening = false;\s+try \{ recognition.stop\(\); \}/);
  assert.match(source,/waitingForCommand = true;\s+endRecognitionForReply\(\);/);
  assert.match(source,/endRecognitionForReply\(\);\s+sendMessage\(command\)/);
  const start=source.split("function startRecognition() {")[1]?.split("function stopHandsFree() {")[0]||"";
  assert.match(start,/discardVoiceResults\) return/);
  const end=source.split("recognition.onend = () => {")[1]?.split("async function sendMessage")[0]||"";
  assert.match(end,/if \(discardVoiceResults\) \{\s+discardVoiceResults = false;/);
});

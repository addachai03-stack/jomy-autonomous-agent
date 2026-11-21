import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeVoiceLanguage,voiceAvailabilityMessage,VOICE_LANGUAGE_KEY} from "../pwa/voice-language.js";

const app=readFileSync(new URL("../pwa/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
const sw=readFileSync(new URL("../pwa/sw.js",import.meta.url),"utf8");

test("voice languages are explicit and default to Hindi safely",()=>{
  assert.equal(normalizeVoiceLanguage("hi-IN"),"hi-IN");
  assert.equal(normalizeVoiceLanguage("en-IN"),"en-IN");
  assert.equal(normalizeVoiceLanguage("bogus"),"hi-IN");
  assert.equal(normalizeVoiceLanguage(null),"hi-IN");
  assert.equal(VOICE_LANGUAGE_KEY,"jomy_voice_language_v1");
});
test("voice availability never claims speech capability that the browser lacks",()=>{
  assert.match(voiceAvailabilityMessage({}),/keyboard microphone/);
  assert.match(voiceAvailabilityMessage({speechRecognition:true,speechSynthesis:false}),/spoken replies unavailable/);
  assert.match(voiceAvailabilityMessage({speechRecognition:true,speechSynthesis:true,lang:"en-IN"}),/English \(India\)/);
  assert.match(voiceAvailabilityMessage({speechRecognition:true,speechSynthesis:true,lang:"hi-IN"}),/Hindi \/ Hinglish/);
});
test("PWA voice choice stops active mic and does not silently restart",()=>{
  assert.match(html,/id="voiceLanguageSelect"/);
  assert.match(html,/value="en-IN"/);
  assert.match(html,/id="voiceCapabilityStatus"/);
  assert.match(app,/voiceLanguageSelect\.addEventListener\("change"/);
  assert.match(app,/if \(handsFree \|\| listening \|\| recognitionStarting\) stopHandsFree\(\)/);
  assert.match(app,/recognition\.lang = voiceLanguage/);
  assert.match(app,/utterance\.lang = voiceLanguage/);
  assert.match(sw,/jomy-agent-shell-v68/);
  assert.match(sw,/voice-language\.js/);
  assert.match(sw,/voice-qa-panel\.js\?v=68/);
  assert.match(sw,/voice-qa\.js/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createVoiceQaState, updateVoiceQaState, voiceQaSummary, VOICE_QA_STEPS, voiceQaLabel} from "../pwa/voice-qa.js";

const app=readFileSync(new URL("../pwa/app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
const ui=readFileSync(new URL("../pwa/voice-qa-panel.js",import.meta.url),"utf8");
const mic=readFileSync(new URL("../pwa/mic-check-ui.js",import.meta.url),"utf8");
const sw=readFileSync(new URL("../pwa/sw.js",import.meta.url),"utf8");
const unified=readFileSync(new URL("../pwa/unified-console.js",import.meta.url),"utf8");

test("all voice checks begin NOT TESTED; unknown events cannot mark PASS",()=>{
 const initial=createVoiceQaState();
 assert.equal(VOICE_QA_STEPS.length,4);
 for(const step of VOICE_QA_STEPS)assert.equal(initial[step],"not-tested");
 assert.deepEqual(updateVoiceQaState(initial,{step:"admin",status:"passed"}),initial);
 assert.deepEqual(updateVoiceQaState(initial,{step:"permission",status:"unknown"}),initial);
 assert.equal(voiceQaLabel("wake"),"Hands-free wake phrase recognized");
});
test("only explicitly observed session event changes the check; transcripts ignored",()=>{
 const original=createVoiceQaState();
 const state=updateVoiceQaState(original,{step:"recognition",status:"passed",transcript:"do-not-include-this",token:"secret"});
 assert.equal(original.recognition,"not-tested");
 assert.equal(state.recognition,"passed");
 assert.equal(state.playback,"not-tested");
 const report=voiceQaSummary(state);
 assert.match(report,/Actual speech recognized: passed/);
 assert.match(report,/Spoken reply completed: not-tested/);
 assert.doesNotMatch(report,/do-not-include-this|secret/);
});
test("UI is accessible, session-only, and does not start or upload microphone audio",()=>{
 for(const key of VOICE_QA_STEPS)assert.match(html,new RegExp('id="voiceQa-'+key+'"'));
 assert.match(html,/id="voiceQaPanel"/);
 assert.match(html,/id="voiceQaCopy"/);
 assert.match(html,/id="voiceQaReset"/);
 assert.match(ui,/jomy:voice-qa/);
 assert.match(ui,/getElementById\("micButton"\)\?\.disabled/);
 assert.match(ui,/voiceQaSummary/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|fetch\(/);
 assert.doesNotMatch(ui,/getUserMedia|SpeechRecognition\(/);
 assert.match(mic,/CustomEvent\("jomy:voice-qa"/);
 assert.match(app,/reportVoiceQa\("recognition","passed"\)/);
 assert.match(app,/reportVoiceQa\("wake","passed"\)/);
 assert.match(app,/reportVoiceQa\("playback","passed"\)/);
 assert.match(app,/reportVoiceQa\("playback","failed"\)/);
 assert.match(app,/CustomEvent\("jomy:connection-status"/);
 assert.match(unified,/window\.addEventListener\("jomy:connection-status",refreshCards\)/);
 assert.match(sw,/jomy-agent-shell-v68/);
 assert.match(sw,/voice-qa-panel\.js\?v=68/);
 assert.match(sw,/voice-qa\.js/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createVoiceQaState, updateVoiceQaState, voiceQaSummary, VOICE_QA_STEPS, voiceQaLabel, nextVoiceQaAction} from "../pwa/voice-qa.js";

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
 assert.match(sw,/jomy-agent-shell-v69/);
 assert.match(sw,/voice-qa-panel\.js\?v=69/);
 assert.match(sw,/voice-qa\.js/);
});

test("guided voice QA shows one manual next step and does not silently pass",()=>{
 let status=createVoiceQaState();
 assert.equal(nextVoiceQaAction(status).targetId,"micPermissionCheck");
 assert.equal(nextVoiceQaAction(status).step,"permission");
 status=updateVoiceQaState(status,{step:"permission",status:"passed"});
 assert.equal(nextVoiceQaAction(status).targetId,"micButton");
 status=updateVoiceQaState(status,{step:"recognition",status:"passed"});
 assert.equal(nextVoiceQaAction(status).targetId,"testVoiceButton");
 status=updateVoiceQaState(status,{step:"playback",status:"passed"});
 assert.equal(nextVoiceQaAction(status).targetId,"handsFreeButton");
 status=updateVoiceQaState(status,{step:"wake",status:"passed"});
 assert.equal(nextVoiceQaAction(status).step,"complete");
 assert.equal(nextVoiceQaAction(status).targetId,"voiceQaCopy");
 assert.match(nextVoiceQaAction(status).guidance,/future reliability/);
});
test("unsupported speech recognition points to dictation after playback test",()=>{
 let status=createVoiceQaState();
 status=updateVoiceQaState(status,{step:"permission",status:"passed"});
 status=updateVoiceQaState(status,{step:"recognition",status:"unsupported"});
 assert.equal(nextVoiceQaAction(status).step,"playback");
 status=updateVoiceQaState(status,{step:"playback",status:"passed"});
 const step=nextVoiceQaAction(status);
 assert.equal(step.step,"fallback");
 assert.equal(step.targetId,"messageInput");
 assert.match(step.guidance,/keyboard microphone/);
});
test("guidance only locates test controls; no microphone or AI requests",()=>{
 assert.match(html,/id="voiceQaNext"/);
 assert.match(html,/id="voiceQaGuide"/);
 assert.match(ui,/nextVoiceQaAction\(state\)/);
 assert.match(ui,/target\.focus\(/);
 assert.doesNotMatch(ui,/target\.click\(/);
 assert.doesNotMatch(ui,/getUserMedia|SpeechRecognition\(|fetch\(/);
 assert.match(app,/reportVoiceQa\("recognition","failed"\)/);
 assert.match(app,/reportVoiceQa\("playback","unsupported"\)/);
 assert.match(sw,/jomy-agent-shell-v69/);
});

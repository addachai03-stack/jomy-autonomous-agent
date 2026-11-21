import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkMicrophonePermission} from "../pwa/mic-permission.js";
const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
const ui=readFileSync(new URL("../pwa/mic-check-ui.js",import.meta.url),"utf8");
const sw=readFileSync(new URL("../pwa/sw.js",import.meta.url),"utf8");

test("tap-only mic check returns supported status and never saves audio",async()=>{
  assert.match(html,/id="micPermissionCheck"/);
  assert.match(html,/id="micPermissionStatus"/);
  assert.match(ui,/addEventListener\("click"/);
  assert.doesNotMatch(ui,/\.record\(|MediaRecorder|fetch\(/);
  assert.match(sw,/mic-check-ui\.js\?v=68/);
  assert.match(sw,/mic-permission\.js/);
  const unsupported=await checkMicrophonePermission(undefined);
  assert.equal(unsupported.code,"unsupported");
});

test("microphone probe stops every acquired track",async()=>{
  let calls=0,stopped=0;
  const r=await checkMicrophonePermission({async getUserMedia(constraints){
    assert.equal(constraints.audio,true);assert.equal(constraints.video,false);calls++;
    return {getTracks(){return [{stop(){stopped++;}},{stop(){stopped++;}}]}};
  }});
  assert.equal(r.ok,true);
  assert.equal(r.code,"granted");
  assert.equal(calls,1);assert.equal(stopped,2);
});
test("microphone denial is explained without recording",async()=>{
  const result=await checkMicrophonePermission({async getUserMedia(){throw Object.assign(new Error("denied"),{name:"NotAllowedError"});}});
  assert.equal(result.ok,false);assert.equal(result.code,"denied");
  assert.match(result.message,/Allow Microphone/);
});
test("missing audio track is never called a working microphone",async()=>{
  const r=await checkMicrophonePermission({async getUserMedia(){return {getTracks(){return []}};}});
  assert.equal(r.ok,false);assert.equal(r.code,"no-audio-track");
});

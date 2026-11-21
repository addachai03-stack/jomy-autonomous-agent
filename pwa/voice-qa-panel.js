import {createVoiceQaState,updateVoiceQaState,VOICE_QA_STEPS,voiceQaSummary,voiceQaLabel} from "./voice-qa.js";
// No mic opened, no speech recognition started, no persistence or external requests.
const root=document.getElementById("voiceQaPanel");
if(root){
 const els=Object.fromEntries(VOICE_QA_STEPS.map(key=>[key,document.getElementById("voiceQa-"+key)]));
 let state=createVoiceQaState();
 // The main module may have detected unsupported speech recognition before this panel loaded.
 if(document.getElementById("micButton")?.disabled)state=updateVoiceQaState(state,{step:"recognition",status:"unsupported"});
 const status=document.getElementById("voiceQaStatus");
 function render(){
   for(const step of VOICE_QA_STEPS){
     const value=state[step],el=els[step];
     if(!el)continue;
     el.textContent=value==="passed"?"PASS · Observed in this session":value==="failed"?"FAILED · Check voice settings":value==="unsupported"?"UNSUPPORTED · Use keyboard dictation":"NOT TESTED";
     el.dataset.status=value;
     el.setAttribute("aria-label",voiceQaLabel(step)+": "+el.textContent);
   }
   const fallback=document.getElementById("voiceQaFallback");
   if(fallback&&!fallback.hidden)fallback.value=voiceQaSummary(state);
 }
 window.addEventListener("jomy:voice-qa",event=>{
   const detail=event?.detail;
   if(!detail||typeof detail!=="object")return;
   state=updateVoiceQaState(state,detail);
   render();
 });
 document.getElementById("voiceQaReset")?.addEventListener("click",()=>{
   state=createVoiceQaState();render();
   const fallback=document.getElementById("voiceQaFallback");
   if(fallback){fallback.hidden=true;fallback.value="";}
   status.textContent="Session voice checks reset. No browser/device settings changed.";
 });
 document.getElementById("voiceQaCopy")?.addEventListener("click",async()=>{
   const report=voiceQaSummary(state);
   try{
     if(!navigator.clipboard?.writeText)throw Error("clipboard unavailable");
     await navigator.clipboard.writeText(report);
     status.textContent="Voice status copied. No recording, conversation or credentials included.";
   }catch(_){
     const area=document.getElementById("voiceQaFallback");
     area.hidden=false;area.value=report;area.focus();area.select();
     status.textContent="Copy this text manually. No data was uploaded.";
   }
 });
 render();
}

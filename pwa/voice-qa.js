// Only local, ephemeral, transcript-free voice diagnostic state.
// Never logs messages, voices, network endpoints, tokens or audio.
export const VOICE_QA_STEPS=Object.freeze(["permission","recognition","playback","wake"]);
const LABELS=Object.freeze({
  permission:"Microphone permission",
  recognition:"Actual speech recognized",
  playback:"Spoken reply completed",
  wake:"Hands-free wake phrase recognized"
});
const ALLOWED=Object.freeze(["not-tested","passed","failed","unsupported"]);
export function createVoiceQaState(){
  return Object.fromEntries(VOICE_QA_STEPS.map(key=>[key,"not-tested"]));
}
export function updateVoiceQaState(previous,detail){
  const state={...createVoiceQaState()};
  for(const key of VOICE_QA_STEPS)if(ALLOWED.includes(previous?.[key]))state[key]=previous[key];
  if(VOICE_QA_STEPS.includes(detail?.step)&&ALLOWED.includes(detail?.status)&&detail.status!=="not-tested")state[detail.step]=detail.status;
  return state;
}
export function voiceQaSummary(state){
  return ["JOMY voice check (THIS browser session only; no audio/transcripts stored)",
    ...VOICE_QA_STEPS.map(step=>LABELS[step]+": "+(ALLOWED.includes(state?.[step])?state[step]:"not-tested")),
    "A passed voice-browser event does not prove 24/7 background listening, future reliability, or another device's microphone permissions."
  ].join("\n");
}
export function voiceQaLabel(step){return LABELS[step]||"";}

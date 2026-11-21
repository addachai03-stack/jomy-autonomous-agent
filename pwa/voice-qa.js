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

/**
 * A guided *manual* next step. It never initiates microphone access, browser
 * speech recognition or AI requests. The user must activate the target button.
 */
export function nextVoiceQaAction(state) {
  const flags=Object.fromEntries(VOICE_QA_STEPS.map(key=>[key, ALLOWED.includes(state?.[key])?state[key]:"not-tested"]));
  if(flags.permission!=="passed" && flags.permission!=="unsupported"){
    return {step:"permission",targetId:"micPermissionCheck",label:"1. Check microphone permission",
      guidance:flags.permission==="failed"?"iPhone Settings / Safari mein is site ke Microphone access ko allow karo, phir Check Microphone Permission tap karo.":"Check Microphone Permission tap karo. JOMY audio store ya upload nahi karega."};
  }
  if(flags.recognition!=="passed" && flags.recognition!=="unsupported"){
    return {step:"recognition",targetId:"micButton",label:"2. Test speech recognition",
      guidance:flags.recognition==="failed"?"Mic permission, connection aur Safari speech support check karo. Tap to speak dobara manually try karo.":"Tap to speak dabao aur 'Hello JOMY' bolo. Sirf browser ke actual final transcript event par PASS hoga."};
  }
  if(flags.playback!=="passed"){
    return {step:"playback",targetId:"testVoiceButton",label:"3. Test spoken reply",
      guidance:flags.playback==="failed"?"iPhone media volume aur Safari speech synthesis check karo; Test Hindi voice dubara tap karo.":"Test Hindi voice button tap karo. Audio play khatam hone par hi PASS hoga."};
  }
  if(flags.wake!=="passed" && flags.recognition!=="unsupported" && flags.permission!=="unsupported"){
    return {step:"wake",targetId:"handsFreeButton",label:"4. Test wake phrase",
      guidance:flags.wake==="failed"?"Hands-free ko band karke manual tap se start karo. Screen unlocked aur foreground mein rakho.":"Hands-free tap karo, phir 'JOMY' bolo. Background/locked iPhone wake listening supported nahi maana ja sakta."};
  }
  if(flags.permission==="unsupported"||flags.recognition==="unsupported"){
    return {step:"fallback",targetId:"messageInput",label:"Use keyboard dictation",
      guidance:"Is browser mein voice input unsupported hai. iPhone keyboard microphone se dictate karo; spoken replies alag test kiye ja sakte hain."};
  }
  return {step:"complete",targetId:"voiceQaCopy",label:"Copy tested results",
    guidance:"Four session checks passed. Yeh sirf current browser session ka result hai; iPhone locked-screen, background listening, future reliability abhi verified nahi hain."};
}

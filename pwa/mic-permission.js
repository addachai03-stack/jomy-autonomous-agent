// Permission-only diagnostic, triggered exclusively by an explicit tap.
// Never records, uploads, or retains microphone audio or MediaStream tracks.
export async function checkMicrophonePermission(mediaDevices = globalThis.navigator?.mediaDevices){
  if(!mediaDevices || typeof mediaDevices.getUserMedia!=="function")return {ok:false,code:"unsupported",message:"This browser does not expose microphone permission checks. Use keyboard dictation or Safari."};
  let stream;
  try{
    stream=await mediaDevices.getUserMedia({audio:true,video:false});
    const tracks=typeof stream?.getTracks==="function"?stream.getTracks():[];
    if(!tracks.length)return {ok:false,code:"no-audio-track",message:"Microphone opened without audio tracks. Check browser permissions."};
    return {ok:true,code:"granted",message:"Microphone permission works. No audio was saved or uploaded. Use Tap to speak or Hands-free next."};
  }catch(error){
    const name=String(error?.name||"");
    if(name==="NotAllowedError"||name==="PermissionDeniedError")return {ok:false,code:"denied",message:"Microphone permission denied. Allow Microphone for this site in Safari settings and retry."};
    if(name==="NotFoundError"||name==="DevicesNotFoundError")return {ok:false,code:"missing",message:"No microphone was found by the browser."};
    if(name==="NotReadableError"||name==="TrackStartError")return {ok:false,code:"busy",message:"Microphone unavailable or already in use by another app."};
    return {ok:false,code:"error",message:"Browser microphone check failed. Try Safari or keyboard dictation."};
  }finally{
    // Critical: release the mic immediately, even if getTracks or other logic throws.
    if(stream && typeof stream.getTracks==="function")for(const track of stream.getTracks()){try{track.stop();}catch(_){}}
  }
}

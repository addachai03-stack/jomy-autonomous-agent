import {checkMicrophonePermission} from "./mic-permission.js";

// This button NEVER starts continuous listening or contacts any server.
const button=document.getElementById("micPermissionCheck");
const output=document.getElementById("micPermissionStatus");
if(button&&output){
  let checking=false;
  button.addEventListener("click",async()=>{
    if(checking)return;
    if(document.hidden){output.textContent="Bring JOMY to the foreground, then tap Check Microphone.";return;}
    checking=true;button.disabled=true;
    output.textContent="Checking iPhone microphone permission… No audio is recorded or uploaded.";
    try{
      const result=await checkMicrophonePermission();
      output.textContent=result.message;
      output.dataset.result=result.code;
    }finally{checking=false;button.disabled=false;}
  });
}

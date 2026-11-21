import {classifyAgentGoal,runAgentGoal,validateAgentGoal,AGENT_TOOL_IDS} from "./agent-engine-core.js";
import {normalizeAgentEndpoint,requestAgentJson} from "./voice-utils.js";

// UI-only controller: no background loops, writes or implicit execution.
const form=document.getElementById("agentEngineForm");
if(form){
 const $=id=>document.getElementById(id);
 const goal=$("agentEngineGoal"),select=$("agentEngineTool"),output=$("agentEngineResult");
 const summary=$("agentEngineStatus"),button=$("agentEngineRun"),review=$("agentEngineReview");
 const ENDPOINT_KEY="jomy_agent_endpoint_v1",TOKEN_KEY="jomy_agent_owner_token_v1";
 let inFlight=false,lastBlockedGoal="";
 const writeLine=(line)=>{
   const item=document.createElement("li");
   item.textContent=String(line).slice(0,500);
   output.append(item);
 };
 function setStatus(label){summary.textContent=label;}
 async function createAiPlan(goalText){
   const savedEndpoint=localStorage.getItem(ENDPOINT_KEY);
   const endpoint=normalizeAgentEndpoint(savedEndpoint===null?"https://jomy-autonomous-agent-api.addachai03.workers.dev/api/agent/chat":savedEndpoint);
   const token=localStorage.getItem(TOKEN_KEY)||sessionStorage.getItem(TOKEN_KEY)||"";
   if(!token)throw new Error("Owner token missing in this browser. Open JOMY Settings; do not paste tokens into goal.");
   const planUrl=endpoint.replace(/\/chat$/,"/plan");
   const {response,data}=await requestAgentJson(planUrl,{
     method:"POST",credentials:"omit",
     headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
     body:JSON.stringify({task:goalText})
   },globalThis.fetch,25000);
   if(!response.ok)throw new Error(response.status===401||response.status===403?"Owner authentication failed. Check Settings.":response.status===429?"AI provider rate limit reached.":"AI planning failed (HTTP "+response.status+").");
   if(data.status!=="planned"||!data.plan||!Array.isArray(data.plan.steps)||data.executed!==false)throw new Error("AI returned an invalid or unverified plan.");
   const steps=data.plan.steps.filter(x=>typeof x==="string"&&x.trim()).slice(0,8);
   if(!steps.length)throw new Error("AI did not supply readable planning steps.");
   return {summary:typeof data.plan.summary==="string"?data.plan.summary.slice(0,240):"AI plan available",steps,restricted:data.plan.actionType==="unsupported"};
 }
 form.addEventListener("submit",async event=>{
   event.preventDefault();
   if(inFlight)return;
   inFlight=true;button.disabled=true;
   review.hidden=true;lastBlockedGoal="";output.replaceChildren();
   setStatus("Checking goal safety gate…");
   try{
     const text=validateAgentGoal(goal.value);
     const mode=select.value;
     if(!AGENT_TOOL_IDS.includes(mode))throw new Error("Invalid agent mode.");
     const classification=classifyAgentGoal(text,mode);
     if(classification.mode==="approval_required"){
       lastBlockedGoal=text;
       setStatus("BLOCKED · Sensitive action requires separate owner approval");
       writeLine(classification.reason);
       review.hidden=false;
     }else if(classification.mode==="ai_plan"){
       setStatus("AI planning request sent · No action execution");
       const plan=await createAiPlan(text);
       setStatus(plan.restricted?"PLAN ONLY · External action unsupported":"AI PLAN CREATED · No tools executed");
       writeLine(plan.summary);
       plan.steps.forEach((step,index)=>writeLine((index+1)+". "+step));
       writeLine("No tools executed, no files changed, no deployment.");
     }else{
       setStatus("Running bounded read-only tools…");
       const result=await runAgentGoal({goal:text,toolId:mode},{
         readTasks:()=>JSON.parse(localStorage.getItem("jomy_agent_task_queue_v1")||"[]"),
         request:globalThis.fetch
       });
       setStatus(result.status==="completed"?"READ-ONLY COMPLETED":result.status==="partial"?"PARTIAL · See checks":"NO TOOL EXECUTED");
       writeLine(result.message);
       for(const tool of result.tools)writeLine(tool.tool+": "+tool.summary);
       writeLine("No background jobs started. No paid tool, code change or external action.");
     }
   }catch(err){
     setStatus("NOT COMPLETED · "+(err?.message||"Tool error"));
     writeLine("No external action was executed.");
   }finally{
     inFlight=false;button.disabled=false;
   }
 });
 review.addEventListener("click",()=>{
   if(!lastBlockedGoal)return;
   const title=$("hubRequestTitle"),notes=$("hubRequestNote"),kind=$("hubRequestKind");
   if(!title||!notes||!kind){setStatus("Approval form not available in this preview.");return;}
   title.value=lastBlockedGoal.slice(0,140);
   notes.value="Agent Engine marked this as restricted. Review action category and scope. Saving does not execute the action.";
   kind.value="code";
   title.scrollIntoView({behavior:"smooth",block:"center"});
   title.focus();
   setStatus("Review form filled locally. Choose action category and SAVE manually. Nothing executed.");
 });
}

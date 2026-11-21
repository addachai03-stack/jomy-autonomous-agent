// JOMY Agent Engine V1: allowlisted, bounded browser orchestration.
// Every external action is denied. Only the fixed public scheduler readiness GET
// and aggregate-only local task counts are implemented.
export const AGENT_TOOL_IDS=Object.freeze(["auto","system_overview","scheduler_readiness","local_task_summary","ai_plan"]);
export const SCHEDULER_READINESS_URL="https://jomy-cloud-scheduler-preview.addachai03.workers.dev/health";
export const AGENT_MAX_GOAL_LENGTH=400;
const DANGEROUS=/(?:\b(?:deploy|publish|release|push|commit|merge|delete|erase|remove|reset|wipe|pay|payment|transfer|withdraw|deposit|purchase|buy|refund|email|whatsapp|telegram|sms|message|send|modify|edit|overwrite|credential|password|secret|api[_ -]?key|token|otp|approve\s+(?:payment|deployment))\b|डिलीट|हटाओ|भेजो|पैसे|भुगतान|खरीदो|रुपये\s*भेज)/i;
const SECRET=/(?:\b(?:password|token|otp|api[_ -]?key|secret)\b\s*[:=]\s*\S+|Bearer\s+[A-Za-z0-9._~+/-]{4,}|sk-[\w-]{12,}|sb_secret_[\w-]+)/i;
export function validateAgentGoal(goal){
 if(typeof goal!=="string")throw new Error("Goal must be text.");
 const text=goal.trim();
 if(text.length<4||text.length>AGENT_MAX_GOAL_LENGTH)throw new Error("Goal must be 4–400 characters.");
 if(SECRET.test(text))throw new Error("Goal contains credential-like content. Do not share secrets.");
 return text;
}
export function classifyAgentGoal(goal,requestedTool="auto"){
 const text=validateAgentGoal(goal);
 if(!AGENT_TOOL_IDS.includes(requestedTool))throw new Error("Unknown agent tool.");
 // Risk gate overrides explicit tool choice. Never let the model or UI choose to bypass.
 if(DANGEROUS.test(text))return {mode:"approval_required",tools:[],reason:"Sensitive or external action detected. No tools ran. Create a separate owner review request; approval here alone never authorizes execution."};
 if(requestedTool==="ai_plan")return {mode:"ai_plan",tools:[],reason:"One optional AI planning call. No tool execution."};
 if(requestedTool==="local_task_summary")return {mode:"read_only",tools:["local_task_summary"],reason:"Read only task counts saved in this browser."};
 if(requestedTool==="scheduler_readiness")return {mode:"read_only",tools:["scheduler_readiness"],reason:"Public scheduler configuration readiness only; not an APPLIQ job result."};
 if(requestedTool==="system_overview")return {mode:"read_only",tools:["local_task_summary","scheduler_readiness"],reason:"Two bounded read-only checks."};
 const lower=text.toLowerCase();
 const local=/(?:\b(?:tasks?|todos?|checklists?|planners?|queues?)\b|टास्क|काम|कार्य)/i.test(lower);
 const scheduler=/(?:\b(?:scheduler|automation|cloud|monitor|health|status|uptime)\b|शेड्यूल|ऑटोमेशन|स्थिति)/i.test(lower);
 const tools=[...(local?["local_task_summary"]:[]),...(scheduler?["scheduler_readiness"]:[])];
 return tools.length?{mode:"read_only",tools,reason:"Matched allowlisted read-only browser tools."}:{mode:"plan_only",tools:[],reason:"Unknown goal. No autonomous tool ran; select AI Plan or a known safe check."};
}
export function summarizeLocalTasks(raw){
 if(!Array.isArray(raw))throw new Error("Local task queue was not an array.");
 // Bounded aggregation only. Never expose task titles, plans, secrets or personal data.
 const list=raw.slice(0,30).filter(t=>t&&typeof t==="object");
 const done=list.filter(t=>["done","succeeded"].includes(t.status)).length;
 const inProgress=list.filter(t=>["in_progress","running"].includes(t.status)).length;
 return {tool:"local_task_summary",status:"completed",summary:list.length+" local tasks · "+done+" done · "+inProgress+" in progress.",counts:{total:list.length,done,inProgress,pending:list.length-done-inProgress},readOnly:true};
}
export async function checkSchedulerReadiness(request=globalThis.fetch){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),8000);
 try{
   const response=await request(SCHEDULER_READINESS_URL,{method:"GET",cache:"no-store",credentials:"omit",mode:"cors",redirect:"error",signal:controller.signal});
   if(!response?.ok)throw new Error("Public scheduler check returned HTTP "+(response?.status??"unknown"));
   const raw=await response.json();
   if(raw?.service!=="JOMY Scheduler Preview")throw new Error("Unexpected scheduler service response.");
   const configured=raw.schedulerEnabled===true&&raw.databaseConfigured===true&&raw.ownerAuthConfigured===true;
   return {tool:"scheduler_readiness",status:"completed",readOnly:true,ready:configured,
     summary:configured?"Scheduler configuration ready; AI review "+(raw.aiReviewEnabled===true?"enabled":"off")+". No job completion verified.":"Scheduler configuration incomplete. No job completion verified."};
 }finally{clearTimeout(timer);}
}
export async function runAgentGoal({goal,toolId="auto"}, {readTasks,request=globalThis.fetch}={}){
 const plan=classifyAgentGoal(goal,toolId);
 if(plan.mode!=="read_only")return {status:plan.mode,executedTools:0,tools:[],message:plan.reason,readOnly:true};
 const toolResults=[];
 for(const id of plan.tools.slice(0,2)){
   try{
     if(id==="local_task_summary"){
       if(typeof readTasks!=="function")throw new Error("Local task reader not configured.");
       toolResults.push(summarizeLocalTasks(await readTasks()));
     }else if(id==="scheduler_readiness")toolResults.push(await checkSchedulerReadiness(request));
   }catch(_){
     toolResults.push({tool:id,status:"failed",readOnly:true,summary:id==="scheduler_readiness"?"Scheduler readiness unavailable; no job verified.":"Local task summary unavailable; storage may be disabled."});
   }
 }
 const passed=toolResults.filter(x=>x.status==="completed").length;
 return {status:passed===toolResults.length?"completed":"partial",executedTools:passed,tools:toolResults,readOnly:true,message:passed+" of "+toolResults.length+" read-only checks completed. No external changes."};
}

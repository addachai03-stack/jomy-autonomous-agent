import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {AGENT_TOOL_IDS,SCHEDULER_READINESS_URL,classifyAgentGoal,validateAgentGoal,runAgentGoal,summarizeLocalTasks,checkSchedulerReadiness} from "../pwa/agent-engine-core.js";
const html=readFileSync(new URL("../pwa/index.html",import.meta.url),"utf8");
const ui=readFileSync(new URL("../pwa/agent-engine-ui.js",import.meta.url),"utf8");
const core=readFileSync(new URL("../pwa/agent-engine-core.js",import.meta.url),"utf8");
const sw=readFileSync(new URL("../pwa/sw.js",import.meta.url),"utf8");

test("agent permits only a bounded, fixed read-only tool registry",()=>{
 assert.deepEqual(AGENT_TOOL_IDS,["auto","system_overview","scheduler_readiness","local_task_summary","ai_plan"]);
 assert.equal(classifyAgentGoal("Check the cloud scheduler and task queue").mode,"read_only");
 assert.deepEqual(classifyAgentGoal("Check the cloud scheduler and task queue").tools,["local_task_summary","scheduler_readiness"]);
 assert.equal(classifyAgentGoal("Invent a brand new marketing campaign").mode,"plan_only");
 assert.equal(classifyAgentGoal("Plan an AI conversation","ai_plan").mode,"ai_plan");
 assert.throws(()=>classifyAgentGoal("Check the scheduler","arbitrary_tool"),/Unknown agent tool/);
 assert.throws(()=>validateAgentGoal("x"),/4–400/);
 assert.throws(()=>validateAgentGoal("password: MySecret00"),/credential-like/);
 assert.throws(()=>validateAgentGoal("a".repeat(401)),/4–400/);
});
test("approval gate always overrides tool choice and no read-only fetch happens",async()=>{
 for(const goal of ["Deploy the JOMY app","Delete a database row","Send payment now","Please send an email","GitHub push code","मेरे पैसे भेजो"]){
   assert.equal(classifyAgentGoal(goal,"system_overview").mode,"approval_required",goal);
 }
 let fetched=0,read=0;
 const result=await runAgentGoal({goal:"Deploy an update to APPLIQ",toolId:"system_overview"},{readTasks:()=>{read++;return[];},request:()=>{fetched++;throw Error("must not run")}});
 assert.equal(result.executedTools,0);
 assert.equal(result.status,"approval_required");
 assert.equal(fetched,0);
 assert.equal(read,0);
});
test("local task diagnostics summarize only counts and never emit titles",async()=>{
 const data=[
  {title:"personal secret title 1",status:"done"},
  {title:"second private note",status:"in_progress"},
  {title:"third private note",status:"queued"}
 ];
 const summary=summarizeLocalTasks(data);
 assert.deepEqual(summary.counts,{total:3,done:1,inProgress:1,pending:1});
 assert.doesNotMatch(JSON.stringify(summary),/personal secret|private note/);
 let calls=0;
 const result=await runAgentGoal({goal:"Count my local tasks",toolId:"local_task_summary"},{readTasks:()=>{calls++;return data;},request:()=>{throw Error("unexpected network")}});
 assert.equal(calls,1);
 assert.equal(result.status,"completed");
 assert.equal(result.executedTools,1);
 assert.equal(result.tools[0].counts.done,1);
});
test("scheduler check uses fixed public endpoint, no credentials and no claims of jobs",async()=>{
 let count=0;
 const request=async(url,options)=>{
   count++;
   assert.equal(url,SCHEDULER_READINESS_URL);
   assert.equal(options.method,"GET");
   assert.equal(options.credentials,"omit");
   assert.equal(options.mode,"cors");
   assert.equal(options.redirect,"error");
   assert.equal(options.headers,undefined);
   return {ok:true,status:200,json:async()=>({service:"JOMY Scheduler Preview",schedulerEnabled:true,databaseConfigured:true,ownerAuthConfigured:true,aiReviewEnabled:false})};
 };
 const summary=await checkSchedulerReadiness(request);
 assert.equal(summary.ready,true);
 assert.match(summary.summary,/No job completion verified/);
 const overview=await runAgentGoal({goal:"Check task queue and scheduler health",toolId:"system_overview"},{readTasks:()=>[],request});
 assert.equal(overview.status,"completed");
 assert.equal(overview.executedTools,2);
 assert.equal(count,2);
 assert.equal(overview.tools.length,2);
});
test("errors are accurately reported as partial without retry, mutation or fake completion",async()=>{
 let count=0;
 const result=await runAgentGoal({goal:"Check local task queue and scheduler health",toolId:"system_overview"},{
   readTasks:()=>[{status:"queued",title:"private"}],
   request:async()=>{count++;throw new Error("network offline");}
 });
 assert.equal(count,1);
 assert.equal(result.status,"partial");
 assert.equal(result.executedTools,1);
 assert.equal(result.tools[1].status,"failed");
 assert.throws(()=>summarizeLocalTasks({}),/not an array/);
});
test("phone UI links real AI planner but never auto-runs AI or external actions",()=>{
 for(const id of ["agentEnginePanel","agentEngineForm","agentEngineGoal","agentEngineTool","agentEngineResult","agentEngineRun","agentEngineReview"])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/AI-generated task plan/);
 assert.match(ui,/requestAgentJson\(planUrl/);
 assert.match(ui,/\/chat\$\/,"\/plan"/);
 assert.match(ui,/lastBlockedGoal/);
 assert.match(ui,/event\.preventDefault\(\)/);
 assert.doesNotMatch(ui,/setInterval\(|\bcron\b|\.click\(\)/);
 assert.doesNotMatch(core,/fetch\([^)]*goal/i);
 assert.match(sw,/jomy-agent-shell-v69/);
 assert.match(sw,/agent-engine-core\.js/);
 assert.match(sw,/agent-engine-ui\.js\?v=69/);
});

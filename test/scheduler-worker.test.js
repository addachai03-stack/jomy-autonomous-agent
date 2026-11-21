import test from "node:test";
import assert from "node:assert/strict";
import worker,{validateJob,executeJob,nextDue,tick} from "../src/scheduler-worker.js";
test("scheduler validates time, bounded inputs and allowed actions",()=>{
 const now=1000000,good={title:"Report",kind:"text_report",input:"one two",runAt:now,repeat:"once"};
 assert.equal(validateJob(good,now).title,"Report");
 assert.throws(()=>validateJob({...good,kind:"send_email"},now),/Unsupported/);
 assert.throws(()=>validateJob({...good,runAt:0},now),/scheduled time/);
 assert.throws(()=>validateJob({...good,input:"x".repeat(4001)},now),/required/);
});
test("scheduler computes real deterministic outputs and daily next run",()=>{
 assert.deepEqual(executeJob({kind:"text_report",input:"one two\nthree"}),{type:"text_report",lines:2,words:3,characters:13});
 assert.deepEqual(executeJob({kind:"checklist",input:"A\n B"}).items,[{text:"A",done:false},{text:"B",done:false}]);
 assert.equal(nextDue(1000,1000,"daily"),86401000);
 assert.equal(nextDue(1000,2*86400000+1000,"daily"),3*86400000+1000);
});
test("private scheduler routes fail closed without configured secret or with wrong token",async()=>{
 for(const env of [{},{SCHEDULER_OWNER_TOKEN:"x".repeat(32)}]){
 const r=await worker.fetch(new Request("https://test.example/api/jobs",{headers:{Authorization:"Bearer invalid"}}),env);
 assert.equal(r.status,401);
 }
 const r=await worker.fetch(new Request("https://test.example/health"),{});
 assert.equal((await r.json()).ownerAuthConfigured,false);
});
test("tick commits exactly once with CAS and a bounded batch, no external tools",async()=>{
 const job={id:"1",title:"Checklist",kind:"checklist",input:"a\nb",due_at:1,repeat:"once"};
 let applied=0,updates=[],queries=[];
 const db={prepare(sql){queries.push(sql);return {bind(...args){return {async all(){assert.equal(args[1],5);return {results:[job]};},async run(){if(sql.startsWith("UPDATE")){updates.push(args);return {meta:{changes:applied++===0?1:0}};}return {meta:{changes:1}};}}}}}};
 assert.deepEqual(await tick(db,100),{completed:1,failed:0});
 assert.deepEqual(await tick(db,100),{completed:0,failed:0});
 assert.equal(updates[0][0],"done");assert.equal(updates[0][5],1);
 assert.equal(JSON.parse(updates[0][2]).items.length,2);
 assert.match(queries.find(s=>s.startsWith("UPDATE")),/status='queued' AND due_at=\?/);
});

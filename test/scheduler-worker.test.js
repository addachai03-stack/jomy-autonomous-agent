import test from "node:test";
import assert from "node:assert/strict";
import worker,{validateJob,executeJob,nextDue,tick,checkWebsite,diagnoseHomepage,reviewDiagnostics} from "../src/scheduler-worker.js";
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

test("heartbeat is returned only to authenticated scheduler owners",async()=>{
 const token="synthetic-for-test-only-xxxxxxxxxxxxxxxx";
 const heartbeat={last_tick_at:1000,last_completed:1,last_failed:0};
 const db={prepare(sql){return {async all(){return {results:[]}},async first(){assert.match(sql,/scheduler_state/);return heartbeat;}};}};
 const env={SCHEDULER_OWNER_TOKEN:token,SCHEDULER_ENABLED:"true",JOBS_DB:db};
 const bad=await worker.fetch(new Request("https://test.example/api/jobs"),env);
 assert.equal(bad.status,401);
 assert.equal((await bad.json()).heartbeat,undefined);
 const good=await worker.fetch(new Request("https://test.example/api/jobs",{headers:{Authorization:"Bearer "+token}}),env);
 assert.equal(good.status,200);
 assert.deepEqual((await good.json()).heartbeat,heartbeat);
 const page=await worker.fetch(new Request("https://test.example/"),env);
 const html=await page.text();
 assert.match(html,/crypto.getRandomValues\(new Uint8Array\(32\)\)/);
 assert.match(html,/navigator.clipboard.writeText\(value\)/);
 assert.doesNotMatch(html,/localStorage|sessionStorage/);
});

test("website health is allowlisted and read only",async()=>{
 const url="https://appliq-app.addachai03.workers.dev/",now=1000000;
 const job={title:"Check",input:url,kind:"website_health",runAt:now,repeat:"once"};
 assert.equal(validateJob(job,now).kind,"website_health");
 for(const input of ["http://localhost/","https://example.com/",url+"?x=1",url+"admin"])assert.throws(()=>validateJob({...job,input},now),/approved/);
 const r=await checkWebsite(url,async(u,o)=>{assert.equal(u,url);assert.equal(o.method,"GET");assert.equal(o.redirect,"manual");assert.ok(o.signal);return new Response("ok",{headers:{"content-type":"text/html"}})});
 assert.equal(r.reachable,true);assert.equal(r.httpStatus,200);assert.equal(r.html,true);
 assert.equal((await checkWebsite(url,async()=>new Response(null,{status:302}))).reachable,false);
 assert.equal((await checkWebsite(url,async()=>{throw Error("network")})).reachable,false);
 await assert.rejects(checkWebsite("https://example.com/"),/not approved/);
});

test("homepage diagnostics reports observed indicators and never claims a security audit",async()=>{
 const url="https://appliq-app.addachai03.workers.dev/";
 const good=await checkWebsite(url,async()=>new Response('<html lang="en"><head><title>APPLIQ</title><meta name="viewport" content="width=device-width"></head><body></body></html>',{headers:{"content-type":"text/html","x-content-type-options":"nosniff"}}));
 for(const n of ["Page title","Mobile viewport","Document language","Content type protection"])assert.equal(good.checks.find(x=>x.name===n).state,"pass");
 assert.equal(good.checks.find(x=>x.name==="Content security policy").state,"warning");
 assert.match(good.note,/No redirects, AI inference/);
 const missing=await checkWebsite(url,async()=>new Response("<html><head></head></html>",{headers:{"content-type":"text/html"}}));
 assert.equal(missing.checks.find(x=>x.name==="Page title").state,"warning");
 const partial=await checkWebsite(url,async()=>new Response("x".repeat(70000),{headers:{"content-type":"text/html"}}));
 assert.equal(partial.checks.find(x=>x.name==="Page title").state,"not_tested");
 assert.equal(JSON.stringify(partial).includes("x".repeat(100)),false);
});

test("AI review fails closed and makes at most one attempt per UTC day",async()=>{
 let attempts=0,claims=0;
 const db={prepare(sql){assert.match(sql,/INSERT INTO ai_review_budget/);return {bind(){return {async run(){return {meta:{changes:claims++===0?1:0}}}}}}}};
 const report={reachable:true,httpStatus:200,elapsedMs:200,checks:[{name:"CSP",state:"warning",detail:"not shared"}],privateValue:"not shared"};
 const env={AI_REVIEW_ENABLED:"true",AI:{async run(model,input){attempts++;assert.equal(model,"@cf/openai/gpt-oss-20b");assert.ok(input.max_tokens<=450);assert.doesNotMatch(JSON.stringify(input),/not shared/);return {response:"Review CSP before editing."};}}};
 assert.equal((await reviewDiagnostics(db,report,{AI:env.AI})).status,"disabled");assert.equal(claims,0);
 assert.equal((await reviewDiagnostics(db,report,env,1000000)).status,"completed");
 assert.equal((await reviewDiagnostics(db,report,env,1000000)).status,"daily_limit");assert.equal(attempts,1);
});

test("owner-only bounded run history and safe render controls",async()=>{
 const token="private-synthetic-test-value-abcdefghij";
 const db={prepare(sql){
   assert.match(sql,/FROM job_runs/);
   assert.match(sql,/LIMIT 30/);
   return {async all(){return {results:[{job_id:"demo",title:"Test",ran_at:1000,status:"done",result:"ok"}]}}};
 }};
 const env={SCHEDULER_OWNER_TOKEN:token,JOBS_DB:db,SCHEDULER_ENABLED:"true"};
 assert.equal((await worker.fetch(new Request("https://test.example/api/history"),env)).status,401);
 const r=await worker.fetch(new Request("https://test.example/api/history",{headers:{Authorization:"Bearer "+token}}),env);
 assert.equal(r.status,200);
 assert.equal((await r.json()).runs.length,1);
 const page=await worker.fetch(new Request("https://test.example/"),env);
 const html=await page.text();
 assert.match(html,/id="history"/);
 assert.match(html,/detail.textContent=j.result/);
});

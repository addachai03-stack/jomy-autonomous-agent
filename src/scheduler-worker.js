// Isolated preview scheduler. No arbitrary tools, outbound network, or AI calls.
const LIMIT=100;
const BATCH=5;
const DAY=86400000;
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}});
function safeEqual(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let diff=0;for(let n=0;n<a.length;n++)diff|=a.charCodeAt(n)^b.charCodeAt(n);return diff===0;}
function authorized(req,env){return typeof env.SCHEDULER_OWNER_TOKEN==="string"&&env.SCHEDULER_OWNER_TOKEN.length>=32&&safeEqual(req.headers.get("Authorization")||"","Bearer "+env.SCHEDULER_OWNER_TOKEN);}
export function validateJob(data,now=Date.now()){
  if(!data||typeof data!=="object"||Array.isArray(data))throw Error("Invalid job.");
  const title=typeof data.title==="string"?data.title.trim():"";
  const input=typeof data.input==="string"?data.input.trim():"";
  if(!title||title.length>120||!input||input.length>4000)throw Error("Title (1–120) and input (1–4000) required.");
  if(!["checklist","text_report"].includes(data.kind))throw Error("Unsupported task type.");
  if(!Number.isSafeInteger(data.runAt)||data.runAt<now-60000||data.runAt>now+365*DAY)throw Error("Select a scheduled time between now and 365 days.");
  if(!["once","daily"].includes(data.repeat))throw Error("Select once or daily.");
  return {title,input,kind:data.kind,runAt:data.runAt,repeat:data.repeat};
}
export function executeJob(job){
  if(typeof job.input!=="string"||!job.input.trim()||job.input.length>4000)throw Error("Invalid input.");
  const lines=job.input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(job.kind==="checklist")return {type:"checklist",items:lines.slice(0,50).map(text=>({text,done:false})),truncated:lines.length>50};
  if(job.kind==="text_report")return {type:"text_report",lines:lines.length,words:job.input.trim().split(/\s+/).length,characters:[...job.input].length};
  throw Error("Unsupported job type.");
}
export function nextDue(previous,now,repeat){
  if(repeat!=="daily")return previous;
  return previous+Math.max(1,Math.floor((now-previous)/DAY)+1)*DAY;
}
export async function tick(db,now=Date.now()){
  const due=await db.prepare("SELECT id,title,kind,input,due_at,repeat FROM jobs WHERE status='queued' AND due_at<=? ORDER BY due_at,id LIMIT ?").bind(now,BATCH).all();
  let completed=0,failed=0;
  for(const job of due.results||[]){
    let result,status="done",next=job.due_at;
    try{result=JSON.stringify(executeJob(job));if(job.repeat==="daily"){status="queued";next=nextDue(job.due_at,now,job.repeat);}}catch(_){result=JSON.stringify({error:"Job input invalid or unsupported."});status="failed";}
    // Deterministic calculation has no side effects. CAS prevents concurrent
    // invocations from committing the same scheduled run twice.
    const update=await db.prepare("UPDATE jobs SET status=?,due_at=?,result=?,last_run_at=?,run_count=run_count+1 WHERE id=? AND status='queued' AND due_at=?").bind(status,next,result,now,job.id,job.due_at).run();
    if(update.meta?.changes===1){if(status==="failed")failed++;else completed++;}
  }
  await db.prepare("INSERT INTO scheduler_state(id,last_tick_at,last_completed,last_failed) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET last_tick_at=excluded.last_tick_at,last_completed=excluded.last_completed,last_failed=excluded.last_failed").bind(now,completed,failed).run();
  return {completed,failed};
}
async function readSmall(req){
  if(Number(req.headers.get("content-length")||0)>12000)throw Error("Request too large.");
  if(!req.body)throw Error("Empty request.");
  const reader=req.body.getReader();let size=0,text="";const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12000){await reader.cancel();throw Error("Request too large.");}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}finally{reader.releaseLock();}
}
const PAGE=String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JOMY Automation Preview</title><style>body{font:16px system-ui;background:#101827;color:#f4e9d4;padding:18px;max-width:620px;margin:auto}h1{font-size:26px}label{display:block;margin:14px 0 5px}input,select,textarea,button{box-sizing:border-box;width:100%;padding:12px;border:1px solid #596579;border-radius:10px;background:#19263a;color:white;font:inherit}button{margin-top:12px;background:#e5c479;color:#151c27;font-weight:700;min-height:44px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}small{color:#b6c4d7}</style><h1>JOMY · Cloud Automation</h1><p>Preview: scheduled checklist and text report jobs run on the server, including while your phone is closed.</p><small>Owner token must be configured privately in the Worker dashboard. Never share it in chat. No external account actions or AI requests run here.</small><label for="token">Scheduler owner token</label><input id="token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false"><details><summary>First-time secure setup</summary><p>1. Generate a private token below (on this device only). Keep it in your password manager. 2. Copy it to your Cloudflare dashboard: Workers &amp; Pages → jomy-cloud-scheduler-preview → Settings → Variables and Secrets. Add a Secret named SCHEDULER_OWNER_TOKEN. 3. Return here and enter the same token, then refresh saved jobs.</p><button id="generateToken" type="button">GENERATE &amp; COPY PRIVATE TOKEN</button><p id="tokenStatus" role="status" aria-live="polite"></p><a href="https://dash.cloudflare.com/" target="_blank" rel="noopener noreferrer" style="color:#e5c479">Open your Cloudflare dashboard</a></details><p id="healthStatus" role="status">Checking service configuration…</p><p id="lastTick" role="status">Sign in to view scheduler heartbeat.</p><label for="title">Task name</label><input id="title" maxlength="120"><label for="kind">Approved action</label><select id="kind"><option value="checklist">Generate a checklist</option><option value="text_report">Generate text report</option></select><label for="input">Input text / one task per line</label><textarea id="input" maxlength="4000" rows="5"></textarea><label for="when">Run at (device local time)</label><input id="when" type="datetime-local"><label for="repeat">Repeat</label><select id="repeat"><option value="once">Once</option><option value="daily">Every day</option></select><button id="schedule">SCHEDULE TASK</button><button id="refresh">REFRESH SAVED JOBS</button><p id="status" role="status" aria-live="polite"></p><div id="jobs"></div><script>(()=>{const $=id=>document.getElementById(id);const status=$("status");let busy=false;$("generateToken").onclick=async()=>{const status=$("tokenStatus");try{const bytes=crypto.getRandomValues(new Uint8Array(32));const value=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");$("token").value=value;try{await navigator.clipboard.writeText(value);status.textContent="Generated and copied. Save this privately in Cloudflare and your password manager. Nothing was sent to a server.";}catch(_){$("token").type="text";$("token").select();status.textContent="Clipboard unavailable. Copy the selected token privately, then hide it by leaving this field.";$("token").addEventListener("blur",()=>$("token").type="password",{once:true});}}catch(_){status.textContent="Could not generate a secure token in this browser.";}};async function health(){try{const r=await fetch("/health",{cache:"no-store"});const d=await r.json();$("healthStatus").textContent=d.ownerAuthConfigured?"Owner secret configured. Enter token to view jobs.":"Owner secret not configured. Complete first-time setup.";if(!d.schedulerEnabled)$("healthStatus").textContent+=" Scheduler disabled.";}catch(_){$("healthStatus").textContent="Service health unavailable.";}}health();async function call(path,method,body){const token=$("token").value;if(!token)throw Error("Enter your scheduler owner token.");const r=await fetch(path,{method,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||"Request failed.");return d;}async function list(){const d=await call("/api/jobs","GET");const host=$("jobs");host.replaceChildren();const t=d.heartbeat;$("lastTick").textContent=t?"Last cloud check: "+new Date(t.last_tick_at).toLocaleString()+" · completed "+t.last_completed+" · failed "+t.last_failed:"No cloud tick recorded yet.";for(const j of d.jobs){const item=document.createElement("section");const title=document.createElement("h3");title.textContent=j.title+" · "+j.status;const p=document.createElement("p");p.textContent="Next/due: "+new Date(j.due_at).toLocaleString()+" · runs: "+j.run_count;const output=document.createElement("pre");output.textContent=j.result||"Awaiting execution";item.append(title,p,output);if(j.status==="queued"){const b=document.createElement("button");b.textContent="CANCEL SCHEDULE";b.onclick=()=>run(async()=>{await call("/api/cancel","POST",{id:j.id});await list();status.textContent="Cancelled.";});item.append(b);}host.append(item);}status.textContent=d.enabled?"Scheduler enabled. Jobs: "+d.jobs.length:"Scheduler disabled.";}async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){status.textContent=e.message;}finally{busy=false;}}$("refresh").onclick=()=>run(list);$("schedule").onclick=()=>run(async()=>{const runAt=new Date($("when").value).getTime();await call("/api/jobs","POST",{title:$("title").value,input:$("input").value,kind:$("kind").value,repeat:$("repeat").value,runAt});await list();status.textContent="Task saved to cloud queue. It will run at or after the selected time.";});})();</script></html>`;
export default {
  async fetch(req,env){
    const url=new URL(req.url);
    if(req.method==="GET"&&url.pathname==="/")return new Response(PAGE,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","content-security-policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'","referrer-policy":"no-referrer","x-content-type-options":"nosniff"}});
    if(req.method==="GET"&&url.pathname==="/health")return json({service:"JOMY Scheduler Preview",schedulerEnabled:env.SCHEDULER_ENABLED==="true",databaseConfigured:!!env.JOBS_DB,ownerAuthConfigured:typeof env.SCHEDULER_OWNER_TOKEN==="string"&&env.SCHEDULER_OWNER_TOKEN.length>=32,intervalMinutes:5});
    if(!authorized(req,env))return json({error:"Scheduler owner authentication required."},401);
    if(!env.JOBS_DB)return json({error:"Scheduler database not configured."},503);
    try{
      if(req.method==="GET"&&url.pathname==="/api/jobs"){
        const data=await env.JOBS_DB.prepare("SELECT id,title,kind,due_at,repeat,status,result,last_run_at,run_count FROM jobs ORDER BY created_at DESC LIMIT 100").all();
        const heartbeat=await env.JOBS_DB.prepare("SELECT last_tick_at,last_completed,last_failed FROM scheduler_state WHERE id=1").first();
        return json({enabled:env.SCHEDULER_ENABLED==="true",jobs:data.results||[],heartbeat:heartbeat||null});
      }
      if(req.method==="POST"&&url.pathname==="/api/jobs"){
        if(env.SCHEDULER_ENABLED!=="true")return json({error:"Scheduler disabled."},503);
        let job;try{job=validateJob(await readSmall(req));}catch(e){return json({error:e.message},400);}
        const id=crypto.randomUUID();
        const res=await env.JOBS_DB.prepare("INSERT INTO jobs(id,title,kind,input,due_at,repeat,status,created_at,run_count) SELECT ?,?,?,?,?,?,'queued',?,0 WHERE (SELECT COUNT(*) FROM jobs)<?").bind(id,job.title,job.kind,job.input,job.runAt,job.repeat,Date.now(),LIMIT).run();
        if(res.meta?.changes!==1)return json({error:"Cloud queue reached its 100-record preview limit."},409);
        return json({id,status:"queued"},201);
      }
      if(req.method==="POST"&&url.pathname==="/api/cancel"){
        let input;try{input=await readSmall(req);}catch(_){return json({error:"Invalid request."},400);}
        if(typeof input?.id!=="string"||input.id.length>100)return json({error:"Invalid job ID."},400);
        const res=await env.JOBS_DB.prepare("UPDATE jobs SET status='cancelled' WHERE id=? AND status='queued'").bind(input.id).run();
        return res.meta?.changes===1?json({status:"cancelled"}):json({error:"Job is no longer queued."},409);
      }
      return json({error:"Not found."},404);
    }catch(_){return json({error:"Scheduler storage unavailable. No success was confirmed."},503);}
  },
  async scheduled(controller,env){
    if(env.SCHEDULER_ENABLED!=="true"||!env.JOBS_DB)return;
    await tick(env.JOBS_DB,Date.now());
  }
};

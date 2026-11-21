import {APPROVAL_STORAGE_KEY, APPROVAL_KINDS, MAX_APPROVAL_ITEMS, normalizeApprovals, createApproval, decideApproval, approvalSummary, buildApprovedHandoff, exportApprovalSnapshot} from "./approval-utils.js";

// The dashboard reads local task counts only. Chat remains in the existing app; the
// cloud scheduler remains a separate owner-authenticated site. No cross-site token sharing.
(() => {
  const $ = id => document.getElementById(id);
  const root=$("unifiedDashboard");
  if(!root)return;
  let items=[];
  const status=$("hubApprovalStatus"), list=$("hubApprovalList"), counter=$("hubApprovalCount");
  const aiStatus=$("hubAiStatus"),taskStatus=$("hubTaskStatus");
  const SCHEDULER_HEALTH_URL="https://jomy-cloud-scheduler-preview.addachai03.workers.dev/health";

  const renderStatus = msg => {status.textContent=msg;};
  try{items=normalizeApprovals(JSON.parse(localStorage.getItem(APPROVAL_STORAGE_KEY)||"[]"));}catch(_){items=[];renderStatus("Browser storage unavailable; previously saved requests could not be loaded.");}
  function save(next) {
    // No optimistic success: if iPhone local storage refuses, leave the old queue.
    localStorage.setItem(APPROVAL_STORAGE_KEY,JSON.stringify(next));
    items=next;
    render();
  }
  function render(){
    list.replaceChildren();
    const summary=approvalSummary(items);counter.textContent=summary.pending+" pending · "+summary.approved+" approved · "+summary.rejected+" rejected";
    if(!items.length){const empty=document.createElement("p");empty.className="hub-hint";empty.textContent="No approval requests yet. Add a review-only request below.";list.append(empty);}
    for(const request of [...items].reverse()){
      const card=document.createElement("article");card.className="approval-card";
      const name=document.createElement("strong");name.textContent=request.title;
      const info=document.createElement("p");info.className="hub-hint";info.textContent=APPROVAL_KINDS[request.kind]+" · "+request.status.toUpperCase()+" · "+new Date(request.createdAt).toLocaleString();
      card.append(name,info);
      if(request.note){const note=document.createElement("p");note.textContent=request.note;card.append(note);}
      if(request.status==="pending"){
        const buttons=document.createElement("div");buttons.className="approval-actions";
        for(const [decision,label] of [["approved","Approve plan only"],["rejected","Reject"]]){
          const button=document.createElement("button");button.type="button";button.textContent=label;
          button.addEventListener("click",()=>{
            try{save(decideApproval(items,request.id,decision));renderStatus(decision==="approved"?"Plan approval saved on this device. NO action was executed.":"Request rejected and saved on this device.");}
            catch(e){renderStatus("Not saved: "+(e?.message||"Storage error"));}
          });buttons.append(button);
        }
        card.append(buttons);
      }
      if(request.status==="approved"){
        const prepare=document.createElement("button");
        prepare.type="button";
        prepare.className="hub-handoff-button";
        prepare.textContent="Prepare manual handoff (no execution)";
        prepare.addEventListener("click",()=>{
          try{
            const brief=buildApprovedHandoff(items,request.id);
            if(card.querySelector(".hub-handoff-text"))return;
            const input=document.createElement("textarea");
            input.className="hub-handoff-text";
            input.readOnly=true;input.rows=9;
            input.setAttribute("aria-label","Approved plan review handoff; not execution authorization");
            input.value=brief;
            const copy=document.createElement("button");
            copy.type="button";copy.className="hub-handoff-button";
            copy.textContent="Copy review brief";
            copy.addEventListener("click",async()=>{
              try{
                if(!navigator.clipboard?.writeText)throw Error("Clipboard unsupported");
                await navigator.clipboard.writeText(brief);
                renderStatus("Review brief copied. No external action was performed. Separate explicit approval is still required.");
              }catch(_){input.focus();input.select();renderStatus("Select and copy the brief manually on this device. No external action performed.");}
            });
            card.append(input,copy);
            renderStatus("Prepared a local review brief only. Nothing was executed or externally authorized.");
          }catch(e){renderStatus("Could not prepare brief: "+(e?.message||"Unknown error"));}
        });
        card.append(prepare);
      }
      list.append(card);
    }
    const maxed=items.length>=MAX_APPROVAL_ITEMS;$("hubRequestSubmit").disabled=maxed;
    $("hubRequestLimit").textContent=items.length+"/"+MAX_APPROVAL_ITEMS+" requests (local only; none executed).";
  }
  function refreshCards(){
    const connection=$("connection")?.textContent?.trim();
    aiStatus.textContent=connection||"Open Settings to connect Chat";
    try{
      const tasks=JSON.parse(localStorage.getItem("jomy_agent_task_queue_v1")||"[]");
      taskStatus.textContent=Array.isArray(tasks)?tasks.length+" tasks on this device":"Local task status unavailable";
    }catch(_){taskStatus.textContent="Local task status unavailable";}
  }
  $("hubApprovalExport")?.addEventListener("click",()=>{
    // Local download only. Do not send approvals, tokens or tasks to cloud.
    try{
      const backup=exportApprovalSnapshot(items);
      const file=new Blob([backup],{type:"application/json;charset=utf-8"});
      const url=URL.createObjectURL(file);
      const link=document.createElement("a");
      link.href=url;link.download="jomy-owner-approval-review.json";
      document.body.append(link);link.click();link.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),10000);
      renderStatus("Local JSON review log prepared for download. No cloud upload or action execution.");
    }catch(e){renderStatus("Export unavailable: "+(e?.message||"Browser download blocked"));}
  });
  $("hubRequestForm")?.addEventListener("submit",event=>{
    event.preventDefault();
    try{
      const form=event.currentTarget;
      const id=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36));
      const next=createApproval(items,{kind:$("hubRequestKind").value,title:$("hubRequestTitle").value,note:$("hubRequestNote").value},Date.now(),id);
      save(next);form.reset();renderStatus("Request saved for OWNER REVIEW only. No messages sent, code edited, payments made or websites published.");
    }catch(e){renderStatus("Not saved: "+(e?.message||"Browser storage error"));}
  });
  $("hubChatLink")?.addEventListener("click",()=>{$("messageInput")?.focus();});
  $("hubDraftFromChat")?.addEventListener("click",()=>{
    // Only a user gesture creates a local form draft; never persist or execute automatically.
    const messages=[...document.querySelectorAll("#messages article.message.user div")];
    const title=messages[messages.length-1]?.textContent?.trim()||"";
    if(!title){renderStatus("Pehle JOMY ko message bhejo, phir draft banao.");return;}
    if(title.length>140){renderStatus("Last chat is too long. Write a short, non-sensitive action summary manually.");return;}
    try{
      createApproval([],{kind:"code",title,note:"Draft from local chat; owner must review and save manually."},Date.now(),"validate-draft-12345678");
      $("hubRequestKind").value="code";
      $("hubRequestTitle").value=title;
      $("hubRequestNote").value="Draft from local chat. Review scope before any action.";
      $("hubRequestTitle").focus();
      $("hubRequestForm").scrollIntoView({behavior:"smooth",block:"center"});
      renderStatus("Draft filled locally; press SAVE FOR OWNER REVIEW only if correct. Nothing submitted yet.");
    }catch(e){renderStatus("Cannot draft this message: "+(e?.message||"Validation failed"));}
  });
  let healthInFlight=false;
  $("hubSchedulerCheck")?.addEventListener("click",async()=>{
    if(healthInFlight)return;
    healthInFlight=true;
    const button=$("hubSchedulerCheck"),output=$("hubSchedulerStatus");
    button.disabled=true;
    output.textContent="Checking public scheduler readiness…";
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(SCHEDULER_HEALTH_URL,{method:"GET",mode:"cors",cache:"no-store",credentials:"omit",redirect:"error",signal:controller.signal});
      if(!response.ok)throw new Error("HTTP "+response.status);
      const info=await response.json();
      if(info?.service!=="JOMY Scheduler Preview")throw new Error("Unexpected service response");
      output.textContent=info.schedulerEnabled&&info.databaseConfigured&&info.ownerAuthConfigured
        ?"Scheduler ready · 5-min cloud ticks · AI review "+(info.aiReviewEnabled?"enabled":"off")+". This is readiness only, not a completed job."
        :"Scheduler configuration needs attention · inspect separate owner dashboard.";
    }catch(_){output.textContent="Cannot verify scheduler status from this browser. Open Scheduler for owner-only details.";}
    finally{clearTimeout(timer);healthInFlight=false;button.disabled=false;}
  });
  $("hubTaskLink")?.addEventListener("click",()=>{if($("activityToggle")?.getAttribute("aria-expanded")!=="true") $("activityToggle")?.click();$("taskPanel")?.scrollIntoView({behavior:"smooth",block:"start"});});
  window.addEventListener("storage",event=>{if(!event.key||event.key===APPROVAL_STORAGE_KEY){try{items=normalizeApprovals(JSON.parse(localStorage.getItem(APPROVAL_STORAGE_KEY)||"[]"));render();}catch(_){}}refreshCards();});
  window.addEventListener("focus",refreshCards);
  render();refreshCards();
  // Task counts are read on user interaction only: no background polling.
  root.addEventListener("click",refreshCards);
})();

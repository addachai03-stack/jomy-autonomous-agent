import {APPROVAL_STORAGE_KEY, APPROVAL_KINDS, MAX_APPROVAL_ITEMS, normalizeApprovals, createApproval, decideApproval, approvalSummary} from "./approval-utils.js";

// The dashboard reads local task counts only. Chat remains in the existing app; the
// cloud scheduler remains a separate owner-authenticated site. No cross-site token sharing.
(() => {
  const $ = id => document.getElementById(id);
  const root=$("unifiedDashboard");
  if(!root)return;
  let items=[];
  const status=$("hubApprovalStatus"), list=$("hubApprovalList"), counter=$("hubApprovalCount");
  const aiStatus=$("hubAiStatus"),taskStatus=$("hubTaskStatus");
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
  $("hubTaskLink")?.addEventListener("click",()=>{if($("activityToggle")?.getAttribute("aria-expanded")!=="true") $("activityToggle")?.click();$("taskPanel")?.scrollIntoView({behavior:"smooth",block:"start"});});
  window.addEventListener("storage",event=>{if(!event.key||event.key===APPROVAL_STORAGE_KEY){try{items=normalizeApprovals(JSON.parse(localStorage.getItem(APPROVAL_STORAGE_KEY)||"[]"));render();}catch(_){}}refreshCards();});
  window.addEventListener("focus",refreshCards);
  render();refreshCards();
  // Task counts are read on user interaction only: no background polling.
  root.addEventListener("click",refreshCards);
})();

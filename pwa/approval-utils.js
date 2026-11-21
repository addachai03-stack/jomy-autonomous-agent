// Explicit owner-review records stored only in this browser. Never execute actions.
export const APPROVAL_STORAGE_KEY = "jomy_owner_approval_inbox_v1";
export const MAX_APPROVAL_ITEMS = 20;
export const APPROVAL_KINDS = Object.freeze({
  code: "Code change / pull request",
  deploy: "Deploy / publish",
  message: "External message",
  payment: "Payment / money",
  delete: "Delete / destructive action"
});
const secretPattern = /(?:\b(?:password|passphrase|api[_ -]?key|secret[_ -]?key|bearer|otp|pin|cvv|token|aadhaar)\b\s*[:=]\s*\S+|sb_secret_[\w-]+|sk-[\w-]{12,})/i;
export function normalizeApprovals(source) {
  if (!Array.isArray(source)) return [];
  return source.filter(row => row && typeof row.id === "string" && row.id.length < 90 &&
    typeof row.title === "string" && row.title.length <= 140 && !secretPattern.test(row.title) &&
    Object.hasOwn(APPROVAL_KINDS, row.kind) &&
    ["pending","approved","rejected"].includes(row.status) &&
    (row.note === undefined || (typeof row.note === "string" && row.note.length <= 400 && !secretPattern.test(row.note)))
  ).slice(-MAX_APPROVAL_ITEMS);
}
export function createApproval(source, data, now=Date.now(), id) {
  const current=normalizeApprovals(source);
  if(current.length>=MAX_APPROVAL_ITEMS) throw new Error("Inbox full (20). Keep old requests until reviewed elsewhere; nothing executed.");
  const title=String(data?.title||"").trim(), note=String(data?.note||"").trim(), kind=data?.kind;
  if(title.length<4||title.length>140||note.length>400||!Object.hasOwn(APPROVAL_KIN,kind))throw new Error("Valid action type, 4–140 character title, and up to 400 character note required.");
  if(secretPattern.test(title)||secretPattern.test(note))throw new Error("Never put passwords, tokens or OTPs in approval requests.");
  if(!Number.isFinite(now)||!Number.isInteger(now)||now<0||typeof id!=="string"||id.length<12||id.length>89)throw new Error("Invalid request identifier.");
  if(current.some(x=>x.id===id))throw new Error("Duplicate request identifier.");
  return [...current,{id,title,note,kind,status:"pending",createdAt:now,decidedAt:null}];
}
export function decideApproval(source,id,decision,now=Date.now()){
  if(!["approved","rejected"].includes(decision))throw new Error("Unsupported decision.");
  let found=false;
  const next=normalizeApprovals(source).map(item=>{
    if(item.id!==id)return item;
    found=true;
    if(item.status!=="pending")throw new Error("This request was already reviewed.");
    return {...item,status:decision,decidedAt:now};
  });
  if(!found)throw new Error("Request not found.");
  return next;
}
export function approvalSummary(source){
  const list=normalizeApprovals(source);
  return {total:list.length,pending:list.filter(x=>x.status==="pending").length,approved:list.filter(x=>x.status==="approved").length,rejected:list.filter(x=>x.status==="rejected").length};
}

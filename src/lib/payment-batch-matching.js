import { indexUploadedPaths } from './payment-sheet-files.js';
import { suggestedEvidenceKind } from './payment-attachments.js';
import { moneyCents } from './invoice-allocation.js';
const norm=v=>String(v||'').normalize('NFKC').replace(/\s/g,'');
const statusOk=f=>f.direction!=='income' && !['failed','pending'].includes(f.paymentStatus);
function conflict(row,f){
 return (f.date && row.date && f.date!==row.date) ||
  (f.seller && row.seller && norm(f.seller)!==norm(row.seller)) ||
  (f.kind==='payment' && moneyCents(f.total)!==null && moneyCents(row.total)!==moneyCents(f.total));
}
export function planPaymentAttachments(records,files,existing=[],{onClaims}={}){
 const plan=new Map(),claims=new Map(),groups=new Map();
 const findReference=indexUploadedPaths(files),paymentsByIdentity=new Map(),orders=new Map();
 const identity=(date,seller,total)=>JSON.stringify([date,norm(seller),moneyCents(total)]);
 const owners=new Map();
 function addOwner(hash,id){if(!hash)return;if(!owners.has(hash))owners.set(hash,new Set());owners.get(hash).add(id);}
 for(const r of existing)for(const hash of [r.evidenceHash,r.evidenceOriginalHash,...(r.evidenceSelection||[]).map(a=>a.hash)])addOwner(hash,r.id);
 function addGroup(key,i){if(!key)return;if(!groups.has(key))groups.set(key,new Set());groups.get(key).add(i);}
 files.forEach((file,i)=>{if(file.normalized)addGroup('text:'+file.normalized,i);if(file.fields?.kind==='payment'&&file.fields.transactionId)addGroup('txn:'+file.fields.transactionId,i);});
 files.forEach(({fields:f={}},i)=>{
  if(f.kind==='order' && f.orderId){if(!orders.has(f.orderId))orders.set(f.orderId,[]);orders.get(f.orderId).push(i);}
  if(f.kind!=='payment'||f.paymentStatus!=='success'||!statusOk(f)||!f.date||!norm(f.seller)||moneyCents(f.total)===null)return;
  const key=identity(f.date,f.seller,f.total);
  if(!paymentsByIdentity.has(key))paymentsByIdentity.set(key,[]);paymentsByIdentity.get(key).push(i);
 });
 for(const row of records){
  const notes=[],proposals=new Map(), explicit=new Set();
  plan.set(row.id,{choices:[],notes});
  if(row.recordType==='合计'||row.linkedLedgerKey||row.supplementOnly||row.duplicateOf)continue;
  for(const ref of row.attachmentRefs||[]){
   const matches=findReference(ref,row.sourceFile||'');
   if(matches.length!==1){notes.push((matches.length?'附件同名，需核对：':'尚缺清单附件：')+ref);for(const i of matches)explicit.add(i);continue;}
   const i=matches[0]; explicit.add(i);proposals.set(i,'清单附件链接或嵌入图片');
  }
  const ordinary=!['阶段汇总','报销批次','现金无凭证'].includes(row.recordType)&&!row.cashWithoutEvidence;
  const matches=ordinary?paymentsByIdentity.get(identity(row.date,row.seller,row.total))||[]:[];
  if(matches.length===1 && !explicit.has(matches[0]) && [...proposals.keys()].every(i=>files[i].fields?.kind==='order'))proposals.set(matches[0],'日期、金额及收款方唯一一致');
  if(matches.length===1 && proposals.has(matches[0])){
   const f=files[matches[0]].fields;
   const supplemental=orders.get(f.orderId)||[];
   if(supplemental.length===1 && !proposals.has(supplemental[0])){
    proposals.set(supplemental[0],'订单号与付款凭证一致');explicit.add(supplemental[0]);
   }
  }
  if(matches.length>1)notes.push('多份付款凭证与本行一致，请核对交易号');
  for(const i of new Set([...explicit,...matches])){
   if(!claims.has(i))claims.set(i,new Set());claims.get(i).add(row.id);
  }
  for(const [i,reason] of proposals){
   const file=files[i],f=file.fields||{};
   if(!statusOk(f)||(row.recordType!=='阶段汇总'&&(file.transactions?.length>1||conflict(row,f)))){notes.push(file.file.name+'：凭证与清单有差异，请核对原件');continue;}
   const taken=owners.get(file.hash);
   if(taken?.has(row.id) && !row.pendingCopies?.some(p=>p.hash===file.hash))continue;
   if(taken && [...taken].some(id=>id!==row.id)){notes.push(file.file.name+'：已关联其他付款');continue;}
   if([file.normalized&&'text:'+file.normalized,f.kind==='payment'&&f.transactionId&&'txn:'+f.transactionId].some(key=>groups.get(key)?.size>1)){notes.push(file.file.name+'：疑似重复副本，请选定原件');continue;}
   plan.get(row.id).choices.push({index:i,kind:suggestedEvidenceKind(file),omit:[],reason});
  }
 }
 for(const [id,result] of plan){
  result.choices=result.choices.filter(choice=>{
   if(claims.get(choice.index)?.size<=1)return true;
   result.notes.push(files[choice.index].file.name+'：多笔付款指向同一附件');return false;
  });
 }
 onClaims?.(claims);
 return plan;
}

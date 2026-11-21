import { moneyCents, withProjectAllocation, isMultiProject } from './invoice-allocation.js';

const norm = value => String(value ?? '').normalize('NFKC').replace(/\s/g, '');
function patch(entry,row,kind,allocations,dir){
 const allowed=new Set(['指定工地','多工地分配','公司开支','个人报账','加油','待确认',...(dir.allocations||[])]);
 if(!allowed.has(row.allocation))throw new Error('费用归属未在档案或固定类型中');
 if(row.project&&!(dir.projects||[]).includes(row.project))throw new Error('工地未命中完整档案：'+row.project);
 if(row.buyer&&kind==='payment'&&!(dir.buyers||[]).includes(row.buyer))throw new Error('归属公司未在购买方档案中');
 if(isMultiProject(entry)&&row.allocation!=='多工地分配'&&entry.projectAllocations?.length)throw new Error('已有多工地分配，不以单项导入覆盖，请先核对原分配');
 let value={allocation:row.allocation,project:row.project||'',expenseOwner:row.owner||entry.expenseOwner||'',assignmentNote:row.note||entry.assignmentNote||''};
 if(row.allocation==='指定工地'&&!row.project)throw new Error('指定工地不能为空');
 const added=allocations.filter(a=>a.kind===(kind==='invoice'?'发票':'付款')&&a.matchId===(row.matchId||row.number)).map(a=>({project:a.project,total:a.total,remark:a.remark}));
 if(added.length&&row.allocation!=='多工地分配')throw new Error('存在分配明细，费用归属应选择多工地分配');
 if(row.allocation==='多工地分配'){
  if(new Set(added.map(a=>a.project)).size!==added.length)throw new Error('分配工地重复，请先合并金额');
  const merged=new Map((entry.projectAllocations||[]).map(a=>[a.project,{...a}]));
  for(const part of added){if(!(dir.projects||[]).includes(part.project))throw new Error('分配工地未在档案中：'+part.project);const old=merged.get(part.project);if(old&&moneyCents(old.total)!==moneyCents(part.total))throw new Error('导入分配与已有工地金额冲突，不覆盖原分配');merged.set(part.project,old||part);}
  const multi=withProjectAllocation(entry,{mode:'multi',rows:[...merged.values()]});value={...value,project:'',projectAllocations:multi.projectAllocations};
 }
 if(kind==='payment'&&row.buyer)value.buyer=row.buyer;
 return value;
}
function fingerprint(entry){return JSON.stringify(entry);}
export function reviewAssignmentImport(source,ledger,payments,dir){
 const review=[];
 for(const [kind,rows]of[['invoice',source.invoices||[]],['payment',source.payments||[]]])for(const row of rows){
  const issues=[];let found=[];
  if(!row.date||moneyCents(row.total)===null)issues.push('缺少有效日期或金额');
  if(kind==='invoice'){
   if(row.numberUnsafe||(!/^\d{18,25}$/.test(row.number||'')&&!row.legacy))issues.push('票号精度或身份信息不足，需核对完整票号');
   found=Object.entries(ledger).filter(([key,e])=>String(e.number||key)===row.number).map(([key,entry])=>({key,entry}));
   if(row.legacy&&row.code)found=found.filter(({entry})=>entry.code===row.code);
  }else{
   found=payments.filter(e=>e.date===row.date&&moneyCents(e.total)===moneyCents(row.total)&&norm(e.seller)===norm(row.seller)&&(!row.payer||norm(e.payer)===norm(row.payer))).map(entry=>({key:entry.id,entry}));
   if(found.length>1&&row.sourceFile&&row.sourceSheet&&row.sourceRow){const exact=found.filter(({entry})=>String(entry.source||entry.id).includes(row.sourceFile)&&(String(entry.id).endsWith('|'+row.sourceSheet+'|'+row.sourceRow)||String(entry.source).endsWith(' / '+row.sourceSheet+' / 行'+row.sourceRow)));if(exact.length)found=exact;}
  }
  if(!found.length)issues.push(kind==='invoice'?'未找到已保存发票；不新增发票':'未找到付款款项；请先导入对应付款清单');
  if(found.length>1)issues.push('存在多个同日期、金额及收款信息候选，需先核对来源');
  const target=found.length===1?found[0]:null;let proposed=null;
  if(target){const e=target.entry;if(e.date!==row.date||moneyCents(e.total)!==moneyCents(row.total))issues.push('原记录日期或金额与导入表冲突');if(kind==='invoice'&&row.buyer&&norm(row.buyer)!==norm(e.buyer))issues.push('票面购买方冲突');if(row.seller&&norm(e.seller)!==norm(row.seller))issues.push('销售方或收款名称冲突');try{proposed=patch(e,row,kind,source.allocations||[],dir);}catch(error){issues.push(error.message);}}
  const unchanged=target&&proposed&&Object.entries(proposed).every(([key,value])=>JSON.stringify(target.entry[key]??'')===JSON.stringify(value));
  review.push({id:row.id,kind,row,targetKey:target?.key||'',previous:target?{...target.entry}:null,fingerprint:target?fingerprint(target.entry):'',patch:proposed,issues,status:issues.length?'需核对':unchanged?'已一致':'可更新',canApply:!issues.length&&!unchanged});
 }
 const keys=new Map();for(const item of review.filter(i=>i.targetKey)){const key=item.kind+'|'+item.targetKey;const previous=keys.get(key);if(previous){previous.canApply=false;item.canApply=false;previous.status=item.status='重复目标';previous.issues.push('同一目标在导入表出现多行，请合并后再导入');item.issues.push('同一目标在导入表出现多行，请合并后再导入');}else keys.set(key,item);}
 return review;
}
export function applyAssignmentReview(review,selected,ledger,payments,dir){
 const ids=new Set(selected),nextLedger={...ledger},nextPayments=payments.map(p=>({...p}));let invoicesUpdated=0,paymentsUpdated=0;
 for(const item of review.filter(i=>ids.has(i.id))){
  if(!item.canApply)throw new Error('所选行未通过核对');
  const current=item.kind==='invoice'?ledger[item.targetKey]:payments.find(p=>p.id===item.targetKey);
  if(!current||fingerprint(current)!==item.fingerprint)throw new Error('预览后记录有变化，请重新预览并确认');
  if(item.patch.project&&!(dir.projects||[]).includes(item.patch.project))throw new Error('预览后工地档案有变化，请重新预览');
  if(item.patch.projectAllocations?.some(part=>!(dir.projects||[]).includes(part.project)))throw new Error('预览后分配工地档案有变化，请重新预览');
  if(item.kind==='invoice'){nextLedger[item.targetKey]={...current,...item.patch};invoicesUpdated++;}else{const i=nextPayments.findIndex(p=>p.id===item.targetKey);nextPayments[i]={...current,...item.patch};paymentsUpdated++;}
 }
 return {ledger:nextLedger,payments:nextPayments,invoicesUpdated,paymentsUpdated};
}
export function persistAssignmentImport(result,ports){
 ports.writeBackup({savedAt:new Date().toISOString(),ledger:ports.previousLedger,payments:ports.previousPayments});
 let ledgerWritten=false;
 try{ports.writeLedger(result.ledger);ledgerWritten=true;ports.writePayments(result.payments);}catch(error){if(ledgerWritten)ports.writeLedger(ports.previousLedger);throw error;}
}

import {computed,ref,shallowRef} from 'vue';
import {readPaymentBatch} from '../lib/payment-records.js';
import {recognizePaymentEvidenceFile} from '../lib/payment-evidence-import.js';
import {fileHash} from '../lib/file-utils.js';
import {reviewPaymentImport,paymentEvidenceCandidates} from '../lib/payment-reconciliation.js';
import {planPaymentAttachments} from '../lib/payment-batch-matching.js';

export function usePaymentBatch(props,emit){
 const records=ref([]),evidence=shallowRef([]),queue=ref([]),recognitionIssues=ref([]),busy=ref(false),loaded=ref(false),progress=ref('');
 const selections=ref({}),excluded=ref([]),confirmed=ref([]),manualTarget=ref('');
 const sheetReview=computed(()=>reviewPaymentImport(records.value,props.existingRows,evidence.value,props.period,{confirmed:confirmed.value,excluded:excluded.value}));
 const plan=computed(()=>{
  const all=new Map(props.existingRows.map(r=>[r.id,r]));
  for(const item of sheetReview.value)all.set(item.record.id,{...all.get(item.record.id),...item.record});
  return planPaymentAttachments([...all.values()],evidence.value,props.existingRows);
 });
 const savedFiles=computed(()=>new Map(props.existingRows.map(r=>{
  const pending=new Set((r.pendingCopies||[]).map(p=>p.hash));
  const saved=[r.evidenceHash,r.evidenceOriginalHash,...(r.evidenceSelection||[]).map(p=>p.hash)].filter(h=>h&&!pending.has(h));
  return [r.id,new Set(saved)];
 })));
 const selectedFor=id=>(selections.value[id]??plan.value.get(id)?.choices??[]).filter(choice=>!savedFiles.value.get(id)?.has(evidence.value[choice.index]?.hash));
 const reviewed=computed(()=>{
  const ids=new Set(records.value.map(r=>r.id));
  const result=sheetReview.value.map(item=>{
   const existing=item.status==='来源已存在'&&!item.record.linkedLedgerKey&&!item.record.supplementOnly&&!item.record.duplicateOf;
   const proposed=selectedFor(item.record.id);
   const issues=proposed.length?item.issues.filter(note=>!note.startsWith('暂无匹配凭证')):item.issues;
   return {...item,issues,existing,canImport:item.canImport||existing};
  });
  if(evidence.value.length)for(const record of props.existingRows){
   if(ids.has(record.id)||record.linkedLedgerKey||record.supplementOnly||record.duplicateOf)continue;
   const candidates=paymentEvidenceCandidates(record,evidence.value);
   if(record.id!==manualTarget.value&&!selectedFor(record.id).length&&!candidates.length)continue;
   result.push({record,status:'已有付款 · 补附件',issues:[],candidates,canImport:true,existing:true});
  }
  return result;
 });
 const importable=computed(()=>reviewed.value.filter(i=>i.canImport&&!excluded.value.includes(i.record.id)&&(!i.existing||selectedFor(i.record.id).length)));
 function reset(){
  records.value=[];evidence.value=[];queue.value=[];recognitionIssues.value=[];loaded.value=false;excluded.value=[];confirmed.value=[];selections.value={};manualTarget.value='';emit('evidence',[]);
 }
 async function prepare(files){
  if(!files.length||busy.value||props.saving)return;
  busy.value=true;loaded.value=true;
  try{
   const pending=[],ids=new Set(records.value.map(r=>r.id));
   for(const file of files.filter(f=>/\.xlsx?$/i.test(f.name)&&!f.name.startsWith('~$'))){
    const source=file.webkitRelativePath||file.name;
    try{
     const batch=readPaymentBatch(await file.arrayBuffer(),source);
     pending.push(...batch.embedded);
     if(!batch.records.length)recognitionIssues.value.push(source+'：未找到付款清单表头');
     for(const r of batch.records)if(!ids.has(r.id)){records.value.push(r);ids.add(r.id);}
    }catch(error){recognitionIssues.value.push(source+'：'+error.message);}
   }
   pending.push(...files.filter(f=>/\.(pdf|png|jpe?g|webp|bmp|gif|tiff?)$/i.test(f.name)).map(file=>({file,path:file.webkitRelativePath||file.name})));
   const offset=queue.value.length;
   queue.value.push(...pending.map(p=>({...p,state:'等待读取',detail:''})));
   for(const [i,{file,path}] of pending.entries()){
    const task=queue.value[offset+i];task.state='识别中';progress.value=(i+1)+' / '+pending.length+' · '+file.name;
    try{
     const hash=await fileHash(file),copy=evidence.value.find(item=>item.hash===hash);
     if(copy){
      evidence.value=evidence.value.map(c=>c===copy?{...c,paths:[...new Set([...c.paths,path])]}:c);
      task.state='重复副本';task.detail=copy.file.name;continue;
     }
     let c;
     try{c=await recognizePaymentEvidenceFile(file,{onProgress:info=>{task.detail=info;progress.value=file.name+' · '+info;}});}
     catch(error){c={file,fields:{},warnings:['识别失败，可查看原件：'+error.message]};}
     const normalized=c.pages?.map(p=>p.text.replace(/\s/g,'')).join('\n');
     const same=normalized&&evidence.value.find(item=>item.normalized===normalized);
     evidence.value=[...evidence.value,{...c,paths:[path],hash,normalized,duplicateHint:same?'与 '+same.file.name+' 识别文字相同':''}];
     task.state=c.fields?.date||c.fields?.seller||c.fields?.kind==='order'?'已识别':'待核对';
     task.detail=[c.fields?.date,c.fields?.seller,c.fields?.total!==''&&c.fields?.total!=null?c.fields.total+' 元':''].filter(Boolean).join(' · ')||c.warnings?.[0]||'查看原件核对';
     for(const warning of c.warnings||[])recognitionIssues.value.push(file.name+'：'+warning);
    }catch(error){task.state='读取失败';task.detail=error.message;}
    finally{emit('evidence',evidence.value);}
   }
  }catch(error){emit('error',error.message);}finally{busy.value=false;progress.value='';}
 }
 function commit(batchStatus){
  if(props.saving||busy.value)return;
  const owners=new Map();
  for(const r of props.existingRows)for(const hash of [r.evidenceHash,r.evidenceOriginalHash,...(r.evidenceSelection||[]).map(p=>p.hash)].filter(Boolean))owners.set(hash,r.id);
  const entries=[];
  for(const {record,existing} of importable.value){
   const attachments=[];
   for(const {index,kind,omit} of selectedFor(record.id)){
    const candidate=evidence.value[index];
    if(owners.has(candidate.hash)&&owners.get(candidate.hash)!==record.id){emit('error',candidate.file.name+' 已分配到其他付款，请只保留一处');return;}
    owners.set(candidate.hash,record.id);attachments.push({candidate,kind,omit:[...omit]});
   }
   entries.push({existing:!!existing,record:{...record,reimbursement:batchStatus==='沿用清单'?record.originalStatus||'未核对':batchStatus},attachments});
  }
  if(entries.length)emit('commit',entries);
 }
 return {queue,records,evidence,recognitionIssues,busy,loaded,progress,selections,excluded,confirmed,manualTarget,reviewed,importable,plan,selectedFor,reset,prepare,commit};
}

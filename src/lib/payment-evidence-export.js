import { isTauri, invokeTauri } from './platform.js';
import { bytesToBase64 } from './file-utils.js';
function paymentDate(value){
 const m=String(value||'').match(/^(20\d{2})-(\d{2})-(\d{2})$/);
 if(!m)return '';
 const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
 return d.toISOString().slice(0,10)===m[0]?m[0]:'';
}
import { sanitizeFilePart } from './invoice-export-package.js';

function part(value, fallback) {
 const result = sanitizeFilePart(value, fallback).replace(/^\.+$/, fallback);
 return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(result) ? '_'+result : result;
}
function extension(item) {
 const name=String(item.name||item.blob?.name||'');
 const ext=name.match(/\.([a-z0-9]{1,8})$/i)?.[0];
 if(ext)return ext.toLowerCase();
 const t=item.blob?.type||'';
 return ({'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf','image/bmp':'.bmp','image/gif':'.gif','image/tiff':'.tif'})[t]||'.bin';
}
function shortId(id) {
 let n=2166136261;for(const c of String(id||'')){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return (n>>>0).toString(16).padStart(8,'0');
}
// Naming uses only confirmed business data; summary dates and totals are not individual transaction details.
export function paymentEvidenceExportPlan(record, items) {
 if(!record?.id)throw new Error('缺少付款记录标识');
 const files=(items||[]).filter(x=>x?.blob);
 if(!files.length)throw new Error('尚无可导出的附件');
 const day=paymentDate(record.date);
 const dateLabel=record.recordType==='阶段汇总' ? part(record.dateRange,'日期范围未知') : part(day,'日期未知');
 const seller=part(record.seller,'收款方未知');
 const n=record.total===''||record.total==null?NaN:Number(record.total);
 const amount=Number.isFinite(n)?n.toFixed(2)+'元':'金额未知';
 const folder=part([dateLabel,seller,amount,shortId(record.id)].join('-'),'付款业务');
 const single=files.length===1&&record.recordType!=='阶段汇总'&&files[0].kind==='付款凭证';
 return {folder,files:files.map((item,index)=>{
  const kind=part(item.kind,'附件');
  const stem=single ? [part(day,'日期未知'),seller,amount].join('-') : String(index+1).padStart(2,'0')+'-'+kind;
  return {name:part(stem,'附件')+extension(item),blob:item.blob};
 })};
}
async function browserWrite(root,parts,name,blob){
 let dir=root;for(const p of parts)dir=await dir.getDirectoryHandle(p,{create:true});
 const ext=name.match(/\.[^.]+$/)?.[0]||'',stem=ext?name.slice(0,-ext.length):name;
 let candidate=name, suffix=2;
 while(true){
  try { await dir.getFileHandle(candidate); }
  catch(e){ if(e?.name==='NotFoundError') break; throw e; }
  candidate=stem+'('+suffix+')'+ext;
  suffix++;
 }
 const handle=await dir.getFileHandle(candidate,{create:true}),writer=await handle.createWritable();
 try{await writer.write(blob);await writer.close();}catch(e){await writer.abort?.();throw e;}
 return [...parts,candidate].join('/');
}
// write is injectable for testing; returns individual paths, never moves input files.
export async function writePaymentEvidenceCopies(record,items,write){
 const plan=paymentEvidenceExportPlan(record,items),paths=[];
 for(const file of plan.files)paths.push(await write(['付款凭证整理',plan.folder],file.name,file.blob));
 return {folder:plan.folder,paths};
}
export async function pickPaymentExportWriter(){
 if(isTauri()){
  const root=await invokeTauri('pick_export_dir');if(!root)return null;
  return async(parts,fileName,blob)=>invokeTauri('write_export_file',{root,parts,fileName,dataBase64:bytesToBase64(await blob.arrayBuffer())});
 }
 if(typeof window==='undefined'||typeof window.showDirectoryPicker!=='function')throw new Error('当前环境不支持选择目录导出，请使用桌面版或支持目录选择的浏览器');
 let root;try{root=await window.showDirectoryPicker({mode:'readwrite'});}catch(e){if(e?.name==='AbortError')return null;throw e;}
 return (parts,name,blob)=>browserWrite(root,parts,name,blob);
}

export async function exportPaymentEvidenceCopies(record,items){
 paymentEvidenceExportPlan(record,items);
 const write=await pickPaymentExportWriter();
 return write?writePaymentEvidenceCopies(record,items,write):{canceled:true};
}

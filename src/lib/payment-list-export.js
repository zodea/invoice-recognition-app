import { paymentColumns } from './expense-columns.js';
import { paymentEvidenceExportPlan } from './payment-evidence-export.js';
const extra=[['recordType','记录类型'],['dateRange','日期范围'],['reimbursement','报销状态'],['source','原清单位置']];
const lineKeys=new Set(['purpose','unit','quantity','unitPrice','lineAmount']);
export async function exportPaymentList(records,attachmentsFor,write) {
 const XLSX = await import('xlsx/xlsx.mjs');
 const columns=[...paymentColumns,...extra],rows=[],merges=[],links=[];
 let fileCount=0,maxFiles=0;
 for(const record of records){
  const items=await attachmentsFor(record);
  const paths=[];
  if(items.length){
   const plan=paymentEvidenceExportPlan(record,items);
   for(const f of plan.files){
    const actual=await write(['付款凭证',plan.folder],f.name,f.blob);
    paths.push(actual.replaceAll('\\','/'));fileCount++;
   }
  }
  maxFiles=Math.max(maxFiles,paths.length);
  const lines=record.lines?.length?record.lines:[{purpose:record.purpose}],first=rows.length+1;
  for(const [i,line] of lines.entries()){
   const values=columns.map(([k])=>lineKeys.has(k)?line[k]??'':i===0?record[k]??'':'');
   if(i===0)values.push(...paths);
   rows.push(values);
  }
  for(const [i,path] of paths.entries())links.push({r:first,c:columns.length+i,path});
  if(lines.length>1)for(const [c,[key]] of columns.entries())if(!lineKeys.has(key))merges.push({s:{r:first,c},e:{r:first+lines.length-1,c}});
 }
 const headings=columns.map(([,label])=>label).concat(Array.from({length:maxFiles},(_,i)=>i?'附件'+(i+1):'附件'));
 const sheet=XLSX.utils.aoa_to_sheet([headings,...rows]);
 sheet['!merges']=merges;sheet['!cols']=headings.map(name=>({wch:/附件|备注|原清单/.test(name)?46:16}));
 for(const {r,c,path} of links)sheet[XLSX.utils.encode_cell({r,c})].l={Target:path.split('/').map(encodeURIComponent).join('/')};
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'付款清单');
 const file=new Blob([XLSX.write(book,{type:'array',bookType:'xlsx'})],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const filename=await write([],'付款清单.xlsx',file);
 return {fileCount,filename};
}

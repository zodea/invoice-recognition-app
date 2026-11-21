import * as XLSX from 'xlsx/xlsx.mjs';
import {paymentDate,readPaymentExcel} from './payment-records.js';
export { applyAssignmentReview, reviewAssignmentImport, persistAssignmentImport } from './expense-assignment-review.js';
const norm=v=>String(v??'').normalize('NFKC').replace(/\s/g,'');
const text=v=>String(v??'').trim();
export const assignmentHeaders={
 invoices:['发票号码','发票日期','价税合计','购买方','销售方','费用归属','使用工地','费用归属人','归属备注','原归属年','原报销批次','原清单','原工作表','原行号'],
 payments:['匹配标识','付款日期','实付金额','收款名称','付款名称','费用归属','使用工地','费用归属人','归属备注','归属公司','原归属年','原报销批次','原清单','原工作表','原行号'],
 allocations:['单据类型','匹配标识','工地','分配金额','分配备注']
};
export function isAssignmentWorkbook(wb){return wb.SheetNames.some(name=>['发票归属','付款归属'].includes(name));}
function invoiceListRows(wb, filename) {
 const result = [];
 const epoch = !!wb.Workbook?.WBProps?.date1904;
 for (const sheet of wb.SheetNames) {
  const ws = wb.Sheets[sheet];
  if (!ws['!ref']) continue;
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', range:0});
  const index = rows.findIndex(row => row.some(cell => ['发票号码','数电发票号码','发票号'].includes(norm(cell))));
  if (index < 0) continue;
  const headers = rows[index].map(norm);
  const column = (...names) => names.map(n => headers.indexOf(n)).find(i => i >= 0);
  const numberCol = column('数电发票号码','发票号码','发票号');
  const projectCol = column('使用工地','使用项目','工地','项目名称','工地名称');
  const merges = (ws['!merges'] || []).filter(m => m.s.c === projectCol && m.e.c === projectCol);
  rows.slice(index+1).forEach((row, offset) => {
   const r = index+1+offset, raw = row[numberCol];
   if (!text(raw)) return;
   const get = (...names) => row[column(...names)] ?? '';
   const merge = merges.find(m => m.s.r <= r && r <= m.e.r);
   const project = text((merge ? rows[merge.s.r] : row)[projectCol]);
   const seller = text(get('销售方','公司名称','开票单位','销方名称','销售方名称'));
   const number = text(raw).replace(/\s/g,'');
   const code = text(get('发票代码'));
   // Excel 数值型长号可能已丢失末位，不能从格式或科学计数法补造票号。
   const legacy = /^\d{8}$/.test(number) && !!seller;
   result.push({id:JSON.stringify([filename,sheet,r+1]),fromInvoiceList:true,number,
    numberUnsafe:typeof raw !== 'string' && !legacy,legacy,code,matchId:number,
    date:paymentDate(get('发票日期','开票日期','日期'),epoch),total:get('价税合计','含税金额','金额','金额(元)'),
    buyer:text(get('购买方','购买方名称')),seller,project,allocation:'指定工地',
    sourceFile:filename,sourceSheet:sheet,sourceRow:String(r+1)});
  });
 }
 if (!result.length) throw new Error('未找到含发票号码的清单行，请选择发票清单或归属模板');
 return {invoices:result,payments:[],allocations:[]};
}
export function parseAssignmentWorkbook(bytes,filename='发票清单'){
 const wb=readPaymentExcel(bytes),result={invoices:[],payments:[],allocations:[]};
 if(!isAssignmentWorkbook(wb))return invoiceListRows(wb,filename);
 for(const [kind,name]of[['invoices','发票归属'],['payments','付款归属'],['allocations','多工地分配']]){
  if(!wb.Sheets[name])continue;
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''}),headers=(rows[0]||[]).map(text);const get=(row,label)=>row[headers.indexOf(label)]??'';
  rows.slice(1).forEach((row,index)=>{
   if(!row.some(v=>v!==''&&v!=null))return;
   if(kind==='allocations'){result.allocations.push({kind:text(get(row,'单据类型')),matchId:text(get(row,'匹配标识')),project:text(get(row,'工地')),total:get(row,'分配金额'),remark:text(get(row,'分配备注'))});return;}
   const rawNumber=get(row,'发票号码');
   result[kind].push({id:kind+'|'+(index+2),number:typeof rawNumber==='string'?rawNumber.replace(/\s/g,''):'',numberUnsafe:kind==='invoices'&&typeof rawNumber==='number',matchId:kind==='invoices'?text(rawNumber):text(get(row,'匹配标识')),date:paymentDate(get(row,kind==='invoices'?'发票日期':'付款日期'),!!wb.Workbook?.WBProps?.date1904),total:get(row,kind==='invoices'?'价税合计':'实付金额'),buyer:text(get(row,kind==='invoices'?'购买方':'归属公司')),seller:text(get(row,kind==='invoices'?'销售方':'收款名称')),payer:text(get(row,'付款名称')),allocation:text(get(row,'费用归属')),project:text(get(row,'使用工地')),owner:text(get(row,'费用归属人')),note:text(get(row,'归属备注')),sourceFile:text(get(row,'原清单')),sourceSheet:text(get(row,'原工作表')),sourceRow:text(get(row,'原行号'))});
  });
 }
 if(!isAssignmentWorkbook(wb))throw new Error('请选择归属导入表，工作表应为“发票归属”或“付款归属”');
 for(const part of result.allocations){const rows=part.kind==='发票'?result.invoices:part.kind==='付款'?result.payments:[];if(!rows.some(row=>(row.matchId||row.number)===part.matchId))throw new Error('多工地分配未找到对应归属行：'+part.kind+' / '+part.matchId);}
 return result;
}
export function buildAssignmentTemplate(dir={}){
 const wb=XLSX.utils.book_new();for(const[kind,name]of[['invoices','发票归属'],['payments','付款归属'],['allocations','多工地分配']]){const sheet=XLSX.utils.aoa_to_sheet([assignmentHeaders[kind]]);for(let row=1;row<=2000;row++)sheet['A'+(row+1)]={t:'s',v:'',z:'@'};sheet['!ref']=`A1:${XLSX.utils.encode_col(assignmentHeaders[kind].length-1)}2001`;sheet['!cols']=assignmentHeaders[kind].map(h=>({wch:h.includes('备注')||h==='使用工地'?34:22}));XLSX.utils.book_append_sheet(wb,sheet,name);}
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['档案类型','完整名称'],...(dir.projects||[]).map(p=>['工地',p]),...(dir.buyers||[]).map(p=>['购买方',p]),...(dir.allocations||[]).map(p=>['费用归属',p])]),'可用档案');
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['使用说明'],['请从“批量导入归属”进入，不能作为进项发票或报销清单导入。'],['发票号码按文本输入；日期、金额、购买方及销售方用于核对，不改原业务金额或状态。'],['费用归属：指定工地、公司开支、个人报账、加油、多工地分配；工地名与档案完全一致。'],['多工地分配在分配页填写；未分完保留余额，不猜分摊金额。'],['付款按日期、金额、收款方、付款名称匹配；多候选需填写原清单/工作表/行号。']]),'使用说明');return XLSX.write(wb,{type:'array',bookType:'xlsx'});
}

import * as XLSX from 'xlsx/xlsx.mjs';
import { emptySupplier, normalizeCompanyName } from './supplier-directory.js';
import { IMPORT_FIELDS, supplierMissingFields } from './supplier-schema.js';

export * from './supplier-directory.js';

// Excel 只按明确表头映射，不把简称、开票名称当分供方全称。
const headerKey = value => String(value||'').replace(/[\s*＊]/g,'').replace(/[（(]必填[）)]/g,'');
const aliasesByKey={name:['公司全称','公司名称','销售方','单位名称','分供方名称'],aliases:['简称/别名'],taxNo:['公司税号','税号','信用代码'],contact:['联系人'],bank:['开户银行']};
export function exportSuppliersWorkbookBytes(list) {
 const ws=XLSX.utils.aoa_to_sheet([IMPORT_FIELDS.map(f=>f[1]),...list.map(s=>IMPORT_FIELDS.map(([k])=>k==='aliases'?(s.aliases||[]).join('、'):s[k]??''))]);
 ws['!cols']=IMPORT_FIELDS.map(([k])=>({wch:k==='name'?36:22})); ws['!autofilter']={ref:ws['!ref']};
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'分供方');return XLSX.write(wb,{type:'array',bookType:'xlsx'});
}
export function importSuppliersWorkbookBytes(list, bytes) {
 const wb=XLSX.read(bytes,{type:'array',cellDates:true});let imported=0,added=0,updated=0;const errors=[];
 for(const sheetName of wb.SheetNames){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:true});
  const hi=rows.slice(0,10).findIndex(r=>r.some(v=>['分供方名称','公司全称','公司名称','销售方','单位名称'].includes(headerKey(v))));
  if(hi<0)continue;
  const head=rows[hi].map(headerKey), indexes=Object.fromEntries(IMPORT_FIELDS.map(([k,h])=>[k,head.findIndex(v=>[headerKey(h),...(aliasesByKey[k]||[])].includes(v))]));
  for(let ri=hi+1;ri<rows.length;ri++){
   const row=rows[ri]; if(!row.some(v=>String(v).trim()))continue;
   const record={};
   for(const [key] of IMPORT_FIELDS){const i=indexes[key];if(i<0)continue;const value=row[i];record[key]=value instanceof Date?value.toISOString().slice(0,10):String(value??'').trim();}
   if(record.name==='示例文本'){continue;}
   const issues=[];
   if(!record.name||record.name.length<2)issues.push('请填写分供方名称');
   for(const [key,label,options] of IMPORT_FIELDS)if(options&&record[key]&&!options.includes(record[key]))issues.push(label+'不在选项中');
   if(record.registeredCapital&&(!Number.isFinite(Number(record.registeredCapital))||Number(record.registeredCapital)<0))issues.push('注册资金应为非负数字（万元）');
   if(record.registeredDate&&!/^\d{4}-\d{2}-\d{2}$/.test(record.registeredDate))issues.push('注册日期请用 YYYY-MM-DD');
   for(const key of ['taxNo','bankAccount','phone','contactPhone'])if(indexes[key]>=0&&typeof row[indexes[key]]==='number'&&Math.abs(row[indexes[key]])>=1e15)issues.push('账号或识别号已超过 Excel 数字精度，请按文本重新填写');
   if(issues.length){errors.push({sheet:sheetName,row:ri+1,name:record.name||'',message:issues.join('；')});continue;}
   const hits=list.filter(s=>normalizeCompanyName(s.name)===normalizeCompanyName(record.name)||(record.externalCode&&s.externalCode===record.externalCode));
   if(hits.length>1){errors.push({sheet:sheetName,row:ri+1,name:record.name,message:'名称或唯一识别码对应多条档案，请先核对'});continue;}
   const existing=hits[0];
   if(existing&&normalizeCompanyName(existing.name)!==normalizeCompanyName(record.name)){errors.push({sheet:sheetName,row:ri+1,name:record.name,message:"唯一识别码已属于其他名称的档案，请核对"});continue;}
   if(existing&&record.type&&existing.type&&record.type!==existing.type){errors.push({sheet:sheetName,row:ri+1,name:record.name,message:'同名档案类型不一致，请在编辑界面确认'});continue;}
   record.aliases=String(record.aliases||'').split(/[、,，;；/]+/).map(x=>x.trim()).filter(Boolean);
   imported++;
   if(existing){let changed=false;for(const [k,v] of Object.entries(record)){if(k!=='aliases'&&v&&!existing[k]){existing[k]=v;changed=true;}}
    const merged=[...new Set([...(existing.aliases||[]),...record.aliases])];if(merged.length!==(existing.aliases||[]).length){existing.aliases=merged;changed=true;}
    if(changed){existing.status=supplierMissingFields(existing).length?'待补全':'已建档';updated++;}
   }else{const next={...emptySupplier(),...record,type:record.type||'大宗供应商',source:'excel'};next.status=supplierMissingFields(next).length?'待补全':'已建档';list.push(next);added++;}
  }
 }
 return {imported,added,updated,errors};
}

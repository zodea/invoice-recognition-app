import { appStorage } from './app-storage.js';
import {parseInvoiceFilename} from './invoice-filename.js';
import {standaloneDocumentType} from './document-kind.js';
const normalize=value=>String(value||'').normalize('NFKC').replace(/\s/g,'');
export const supplementStorageKey='invoiceSupplements.v1';
export function supplementType(fields={}) {
 return [fields.attachmentType,fields.docType,fields.type].find(value=>['行程单','快递邮寄明细','邮寄明细','寄件明细','快递明细','行程及费用明细'].includes(value))||'';
}
export function readInvoiceSupplements(storage=appStorage) {
 const records=JSON.parse(storage?.getItem(supplementStorageKey)||'[]');
 if(!Array.isArray(records))throw new Error('附件索引异常，请先检查本地备份');
 return records;
}
export function writeInvoiceSupplements(records,storage=appStorage){storage.setItem(supplementStorageKey,JSON.stringify(records));}
export function supplementInvoiceCandidates(doc,ledger) {
 const fields=doc.fields||{},fallback=parseInvoiceFilename(doc.name),seller=normalize(fields.seller||fallback.seller),date=fields.date||fallback.date;
 const amount=fields.total!==''&&fields.total!=null?fields.total:fallback.total;
 const related=String(fields.relatedInvoiceNumber||fields.invoiceNumber||(String(doc.rawText||'').match(/(?:对应|关联)?发票号码\s*[:：]\s*(\d{18,25})/)||[])[1]||'').replace(/\s/g,'');
 return Object.entries(ledger).filter(([,e])=>!standaloneDocumentType(e)&&!supplementType(e)).flatMap(([key,entry])=>{
  const sameNumber=!!related&&related===String(entry.number||key);
  const sameDate=!!date&&date===entry.date;
  const known=amount!==''&&amount!=null&&entry.total!==''&&entry.total!=null&&Number.isFinite(Number(amount))&&Number.isFinite(Number(entry.total));
  const sameTotal=known&&Math.round(Number(amount)*100)===Math.round(Number(entry.total)*100);
  const sameSeller=!!seller&&seller===normalize(entry.seller);
  const sameBuyer=!!fields.buyer&&normalize(fields.buyer)===normalize(entry.buyer);
  const buyerConflict=!!fields.buyer&&!!entry.buyer&&!sameBuyer;
  const conflict=(sameNumber&&known&&!sameTotal)||((sameNumber||sameDate&&sameTotal&&sameSeller)&&buyerConflict);
  const strong=!conflict&&(related?sameNumber:sameDate&&sameTotal&&sameSeller);
  if(!sameNumber&&!sameTotal&&!sameDate)return [];
  return [{entry:{...entry,key},strong,conflict,score:(sameNumber?20:0)+(sameTotal?4:0)+(sameDate?2:0)+(sameSeller?3:0)+(sameBuyer?1:0),hint:conflict?'关联票号存在，但金额或购买方冲突':sameNumber?'关联发票号码一致':strong?'日期、金额、销售方一致':sameDate&&sameTotal?'日期金额一致，需确认销售方':sameTotal?'仅金额一致，需进一步核对':'仅日期一致，需进一步核对'}];
 }).sort((a,b)=>b.score-a.score);
}
export async function linkInvoiceSupplement(record,key,ports) {
 const existing=ports.getRecords().find(r=>r.hash===record.hash);
 if(existing?.ledgerKey){if(existing.ledgerKey!==key)throw new Error('此附件已关联其他发票');return existing;}
 const ledger=ports.getLedger(),entry=ledger[key];
 if(!entry||standaloneDocumentType(entry)||supplementType(entry))throw new Error('主发票不存在，请先保存主票');
 const prior=Object.entries(ledger).find(([otherKey,value])=>otherKey!==key&&value.supplementHashes?.includes(record.hash));
 if(prior)throw new Error('该附件已经关联发票 '+(prior[1].number||prior[0])+'，不能重复关联');
 const file=await ports.getOriginal('supplement:'+record.hash);if(!file)throw new Error('附件原件不存在，请重新保存');
 await ports.append(key,file,{hash:record.hash,type:supplementType(record.fields)||'附属明细',date:record.fields.date||'',total:record.fields.total});
 const current=ports.getLedger();if(!current[key])throw new Error('主票已被删除，附件仍保留待匹配');
 ports.saveLedger({...current,[key]:{...current[key],supplementHashes:[...new Set([...(current[key].supplementHashes||[]),record.hash])]}});
 const linked={...record,ledgerKey:key,matchedBy:record.matchedBy||'用户确认关联',linkedAt:new Date().toISOString()};
 ports.saveRecords(ports.getRecords().map(r=>r.hash===record.hash?linked:r));return linked;
}
export async function reconcileInvoiceSupplements(ports) {
 let linked=0,failed=0;
 for(const record of [...ports.getRecords()].filter(r=>!r.ledgerKey)){
  const candidates=supplementInvoiceCandidates(record,ports.getLedger()),strong=candidates.filter(c=>c.strong);
  if(strong.length!==1||candidates.some(c=>c.conflict))continue;
  try{await linkInvoiceSupplement({...record,matchedBy:strong[0].hint},strong[0].entry.key,ports);linked++;}catch{failed++;}
 }
 return {linked,failed,pending:ports.getRecords().filter(r=>!r.ledgerKey).length};
}
export async function saveInvoiceSupplement(doc,ports) {
 if(!doc.file)throw new Error('缺少附件原件');
 if(!supplementType(doc.fields))throw new Error('请确认附件类型');
 const hash=await ports.hashFile(doc.file);let record=ports.getRecords().find(r=>r.hash===hash);
 if(!record){
  await ports.saveOriginal('supplement:'+hash,doc.file);
  record=ports.getRecords().find(r=>r.hash===hash);
  if(!record){record={hash,name:doc.name||doc.file.name||'票据附件',fields:{...doc.fields},rawText:doc.rawText||'',ledgerKey:'',savedAt:new Date().toISOString()};ports.saveRecords([...ports.getRecords(),record]);}
 }else if(!record.ledgerKey){
  record={...record,fields:{...record.fields,...doc.fields},rawText:doc.rawText||record.rawText};ports.saveRecords(ports.getRecords().map(r=>r.hash===hash?record:r));
 }
 await reconcileInvoiceSupplements(ports);record=ports.getRecords().find(r=>r.hash===hash);
 return {record,candidates:supplementInvoiceCandidates(record,ports.getLedger())};
}

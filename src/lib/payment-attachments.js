import { fileHash } from './file-utils.js';
import { getLedgerAttachment, saveLedgerAttachmentIfMissing, appendInvoiceSupplement } from './ledger-attachments.js';

export function paymentAttachmentItems(record, stored) {
  const items=[];
  if (stored?.blob) {
    const kind=stored.kind || record?.evidenceKind || '付款凭证';
    items.push({...stored,kind,name:stored.name||stored.blob.name||'原件',
      hash:stored.hash||record?.evidenceOriginalHash||(kind==='付款凭证'?record?.evidenceHash:'')||''});
  }
  for (const item of stored?.supplements||[]) if (item.blob) items.push({...item,name:item.name||item.blob.name||'附件',kind:item.kind||'补充附件'});
  return items;
}
export function activePaymentAttachments(record, items) {
  const excluded=new Set(record?.duplicateAttachmentHashes || []);
  return items.filter(item=>!excluded.has(item.hash));
}
export function suggestedEvidenceKind(candidate) {
  const f=candidate.fields||{};
  if (f.kind==='order') return '订单详情';
  if (f.direction==='income' || ['pending','failed'].includes(f.paymentStatus)) return '其他附件';
  if (f.kind==='payment' || candidate.transactions?.some(t=>(t.fields||t).kind==='payment')) return '付款凭证';
  return '其他附件';
}
// Write the binary and its role together. Repeating a failed ledger update
// can recover the same binary by hash without replacing the primary original.
export async function linkPaymentFile(record, candidate, kind) {
  const file=candidate.file, key='payment:'+record.id, hash=await fileHash(file);
  if (candidate.fields?.kind==='order') kind='订单详情';
  const metadata={hash,kind,fields:candidate.fields||{},transactions:(candidate.transactions||[]).map(({page,index,fields})=>({page,index,fields}))};
  let stored=await getLedgerAttachment(key);
  if (!stored?.blob) {
    if (await saveLedgerAttachmentIfMissing(key,file,metadata))
      stored={...stored,...metadata,blob:file,name:file.name};
    else stored=await getLedgerAttachment(key);
  }
  const items=paymentAttachmentItems(record,stored);
  let found;
  for (const item of items) {
    if ((item.hash||await fileHash(item.blob))===hash) {found=item;break;}
  }
  if (!found) await appendInvoiceSupplement(key,file,metadata);
  const payment=activePaymentAttachments(record,items).find(item=>item.kind==='付款凭证') || (!found && kind==='付款凭证' ? metadata : null);
  return {evidenceName:items[0].name,evidenceKind:items[0].kind,evidenceOriginalHash:items[0].hash||await fileHash(items[0].blob),
    evidenceCount:items.length+Number(!found),evidenceHash:payment ? payment.hash || await fileHash(payment.blob) : '',evidenceConfirmed:false};
}

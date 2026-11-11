import { deductionStatus, redInvoiceStatus } from './invoice-ledger.js';
export function deductionDisplay(entry = {}) {
  const time = String(entry.selectionTime || '').trim();
  if (time && !/^(--|—|无|暂无|未勾选|未认证)$/.test(time)) return {label:time,hasTime:true,title:'已抵扣'};
  const status = deductionStatus(entry);
  return {label:status === '已抵税' ? '已抵扣' : status,hasTime:false,title:status === '已抵税' ? '已抵扣（无勾选时间）' : status};
}
export function invoiceStatusTags(entry = {}) {
  const red = redInvoiceStatus(entry);
  const raw = String(entry.invoiceStatus || '').trim();
  const tags = [];
  if (red) tags.push({label:red,tone:'red'});
  if (raw && !(red && (/红冲|冲红/.test(raw) || raw === '正常'))) tags.push({label:raw,tone:raw==='正常'?'green':'amber'});
  return tags;
}

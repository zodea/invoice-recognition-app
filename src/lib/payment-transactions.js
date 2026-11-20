import { paymentDate } from './payment-records.js';

export function paymentRange(value) {
  const parts = String(value || '').split(/\s*(?:至|到|[~～—])\s*/);
  const start = parts.length === 2 ? paymentDate(parts[0]) : '';
  const end = parts.length === 2 ? paymentDate(parts[1]) : '';
  return { start, end, label: parts.length === 2 ? (parts[0] || '未知')+'至'+(parts[1] || '未知') :
    value ? value+'（起止未明确）' : '日期范围未知' };
}
export function coveredTruncatedTransactions(transactions, corroborating) {
  const covered = new Set();
  for (const [index, item] of transactions.entries()) {
    if (item.complete !== false || item.orderId || item.transactionId || !item.date || !item.sourceGroup || item.total === '' || item.total == null) continue;
    const matches = corroborating.filter(candidate => candidate.complete && candidate.date === item.date && Math.round(Number(candidate.total) * 100) === Math.round(Number(item.total) * 100) && (!item.seller || item.seller === candidate.seller) && item.sourceGroup === candidate.sourceGroup);
    const ids = new Set(matches.map(candidate => candidate.transactionId || candidate.orderId).filter(Boolean));
    if (ids.size === 1) covered.add(index);
  }
  return covered;
}
export function reconcileEvidenceTransactions(items, expected, dateRange = '') {
  const { start, end } = paymentRange(dateRange);
  const observations = items.map(item => ({item, t:item.fields || item}));
  // One order may have several successful payments. An order-only observation
  // is ambiguous if that order appears with two distinct payment IDs.
  const orders = new Map();
  for (const {t} of observations) {
    if (t.orderId && t.transactionId) {
      if (!orders.has(t.orderId)) orders.set(t.orderId, new Set());
      orders.get(t.orderId).add(t.transactionId);
    }
  }
  const groups = new Map(), unresolved = [], unique = [], duplicates = [];
  for (const {item,t} of observations) {
    const ids = orders.get(t.orderId);
    const valid = t.kind === 'payment' && t.direction !== 'income' && t.paymentStatus === 'success'
      && t.complete !== false && paymentDate(t.date) && (!start || t.date >= start) && (!end || t.date <= end)
      && t.total !== '' && t.total != null && Number.isFinite(Number(t.total)) && (t.transactionId || t.orderId);
    if (!valid || (!t.transactionId && ids?.size > 1)) { unresolved.push(item); continue; }
    const id = t.transactionId || (ids?.size === 1 && [...ids][0]);
    const key = id ? '交易:'+id : '订单:'+t.orderId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({item,t});
  }
  for (const group of groups.values()) {
    const conflicts = ['date','seller','orderId','total'].some(key =>
      new Set(group.map(({t})=>t[key]).filter(v=>v!=='' && v!=null).map(v=>key==='total'?Math.round(Number(v)*100):v)).size>1);
    if (conflicts) unresolved.push(...group.map(x=>x.item));
    else { unique.push(group[0].item); duplicates.push(...group.slice(1).map(x=>x.item)); }
  }
  const cents = unique.reduce((n,item)=>n+Math.round(Number((item.fields||item).total)*100),0);
  return {unique,duplicates,unresolved,total:cents/100,matches:!unresolved.length && unique.length>0 && expected!=='' && expected!=null && cents===Math.round(Number(expected)*100),
    needsReview:!!(unresolved.length || duplicates.length)};
}

import { standaloneDocumentType } from './document-kind.js';

export const buyerCheckLabels = {
  missing: '购买方未填写',
  unmatched: '购买方不在档案中',
  matched: '已匹配购买方档案',
  exempt: '无需购买方',
  unconfigured: '请先添加购买方档案',
};

export function normalizeBuyerName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

export function createBuyerChecker(buyers = []) {
  const names = new Set(buyers.map(normalizeBuyerName).filter(Boolean));
  return (entry = {}) => {
    if (standaloneDocumentType(entry)) return 'exempt';
    if (!names.size) return 'unconfigured';
    const buyer = normalizeBuyerName(entry.buyer);
    if (!buyer) return 'missing';
    return names.has(buyer) ? 'matched' : 'unmatched';
  };
}

export function matchesBuyerCheck(status, filter) {
  if (filter === 'all') return true;
  if (filter === 'issues') return status === 'missing' || status === 'unmatched';
  return status === filter;
}

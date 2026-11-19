import { allocationKind } from './payment-records.js';
import { isMultiProject, projectExpenseRows } from './invoice-allocation.js';

export function expenseSummary(entries, bySeller = false, options = {}) {
  const { groupBy = 'combined', projectFilter = '', allocationFilter = '' } = options;
  const map = new Map();
  for (const entry of entries) {
    if (entry.supplementOnly) continue;
    const allocation = allocationKind(entry);
    const multi = isMultiProject(entry);
    const parts = multi ? projectExpenseRows(entry) : [{ project: entry.project, total: Number(entry.total) || 0 }];
    const buyer = entry.buyer || '未归属公司';
    const seller = bySeller ? entry.seller || '未知厂家' : '全部厂家';
    const counted = new Set();
    for (const part of parts) {
      const site = part.project || '未指定工地';
      if ((projectFilter && projectFilter !== site) || (allocationFilter && allocationFilter !== allocation)) continue;
      let project = groupBy === 'allocation' ? '' : site;
      if (groupBy === 'combined') project = multi || allocation === '指定工地' ? site : allocation;
      const kind = ['both', 'allocation'].includes(groupBy) ? allocation : '';
      const key = JSON.stringify([buyer, project, kind, seller]);
      const record = map.get(key) || { buyer, project, allocation: kind, seller, cents: 0, reimbursedCents: 0, count: 0 };
      const cents = Math.round(part.total * 100);
      record.cents += cents;
      if (entry.reimbursement === '已报销') record.reimbursedCents += cents;
      if (!counted.has(key)) { record.count++; counted.add(key); }
      map.set(key, record);
    }
  }
  return [...map.values()].map(record => ({ ...record, total: record.cents / 100, reimbursed: record.reimbursedCents / 100 }));
}

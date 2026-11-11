import { allocationKind } from './payment-records.js';
import { isMultiProject, projectExpenseRows } from './invoice-allocation.js';

export function expenseSummary(entries, bySeller = false) {
  const map = new Map();
  for (const entry of entries) {
    const kind = allocationKind(entry);
    const rows = isMultiProject(entry) ? projectExpenseRows(entry) : [{ project: kind === '指定工地' ? entry.project : kind, total: Number(entry.total) || 0 }];
    for (const row of rows) {
      const buyer = entry.buyer || '未归属公司';
      const seller = bySeller ? entry.seller || '未知厂家' : '全部厂家';
      const key = JSON.stringify([buyer, row.project, seller]);
      const record = map.get(key) || { buyer, project: row.project, seller, cents: 0, reimbursedCents: 0, count: 0 };
      const cents = Math.round(row.total * 100);
      record.cents += cents;
      if (entry.reimbursement === '已报销') record.reimbursedCents += cents;
      record.count++;
      map.set(key, record);
    }
  }
  return [...map.values()].map(record => ({ ...record, total: record.cents / 100, reimbursed: record.reimbursedCents / 100 }));
}

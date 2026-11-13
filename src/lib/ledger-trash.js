import { appStorage } from './app-storage.js';
export const ledgerTrashKey = 'invoiceLedgerTrash.v1';

export function loadLedgerTrash(storage = appStorage) {
  try { return readLedgerTrashForChange(storage); }
  catch { return []; }
}

export function readLedgerTrashForChange(storage = appStorage) {
  const records = JSON.parse(storage?.getItem(ledgerTrashKey) || '[]');
  if (!Array.isArray(records) || records.some(r => !r || !r.id || !r.key || !r.entry)) {
    throw new Error('回收站数据格式异常，请先检查备份，未执行删除或恢复。');
  }
  return records;
}

export function moveLedgerToTrash(ledger, trash, keys) {
  const next = { ...ledger }, removed = [];
  for (const key of new Set(keys)) {
    if (!Object.hasOwn(next, key)) continue;
    removed.push({ id: crypto.randomUUID(), key, entry: next[key], deletedAt: new Date().toISOString() });
    delete next[key];
  }
  return { ledger: next, trash: [...removed, ...trash], changed: removed.length, conflicts: 0 };
}

export function restoreLedgerFromTrash(ledger, trash, ids) {
  const selected = new Set(ids), next = { ...ledger }, remaining = [];
  let changed = 0, conflicts = 0;
  for (const record of trash) {
    if (!selected.has(record.id)) { remaining.push(record); continue; }
    if (Object.hasOwn(next, record.key)) { remaining.push(record); conflicts++; continue; }
    next[record.key] = record.entry;
    changed++;
  }
  return { ledger: next, trash: remaining, changed, conflicts };
}

// 先保存完整备份，再修改台账；任一步写入失败都不会丢失被删除的数据。
export function persistLedgerTransition(result, previousTrash, saveActive, storage = appStorage) {
  const backup = [...new Map([...previousTrash, ...result.trash].map(r => [r.id, r])).values()];
  storage.setItem(ledgerTrashKey, JSON.stringify(backup));
  saveActive(result.ledger);
  let warning = '';
  try { storage.setItem(ledgerTrashKey, JSON.stringify(result.trash)); }
  catch { warning = '台账已保存，但回收站整理失败，备份仍保留。'; }
  return { ...result, trash: warning ? backup : result.trash, warning };
}

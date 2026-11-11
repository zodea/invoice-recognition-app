import { ledgerTrashKey, readLedgerTrashForChange } from './ledger-trash.js';

const cleanupKey = 'invoiceLedgerTrashCleanup.v1';
export function readTrashCleanupQueue(storage = globalThis.localStorage) {
  const value = JSON.parse(storage?.getItem(cleanupKey) || '[]');
  if (!Array.isArray(value) || value.some(key => typeof key !== 'string')) throw new Error('原件清理记录异常，请先检查本地备份。');
  return value;
}

export function planTrashPurge(ledger, trash, ids) {
  const selected = new Set(ids);
  const removed = trash.filter(r => selected.has(r.id));
  const remaining = trash.filter(r => !selected.has(r.id));
  const referenced = new Set([...Object.keys(ledger), ...remaining.map(r => r.key)]);
  return { trash: remaining, changed: removed.length, cleanupKeys: [...new Set(removed.map(r => r.key))].filter(key => !referenced.has(key)) };
}

// 清理队列先落盘。回收站保存失败时，原件仍受现存记录保护；中断后可重试。
export function persistTrashPurge(plan, storage = globalThis.localStorage) {
  const queue = [...new Set([...readTrashCleanupQueue(storage), ...plan.cleanupKeys])];
  storage.setItem(cleanupKey, JSON.stringify(queue));
  storage.setItem(ledgerTrashKey, JSON.stringify(plan.trash));
}

export async function cleanupPurgedAttachments(getLedger, deleteAttachments, storage = globalThis.localStorage) {
  const queue = readTrashCleanupQueue(storage);
  if (!queue.length) return 0;
  const isReferenced = key => Object.hasOwn(getLedger(), key) || readLedgerTrashForChange(storage).some(r => r.key === key);
  await deleteAttachments(queue, isReferenced);
  const processed = new Set(queue);
  storage.setItem(cleanupKey, JSON.stringify(readTrashCleanupQueue(storage).filter(key => !processed.has(key))));
  return queue.length;
}

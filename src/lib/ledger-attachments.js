// Desktop originals live in 数据/blobs; browser development keeps IndexedDB.
import * as legacy from './legacy-ledger-attachments.js';
import { isTauri, invokeTauri } from './platform.js';
import { bytesToBase64 } from './file-utils.js';
import { beginFileWrite, flushLocalData } from './local-data.js';

export async function encodeFile(file) {
  return { name: file.name || '原件', type: file.type || '', lastModified: file.lastModified || 0, dataBase64: bytesToBase64(await file.arrayBuffer()) };
}
export function decodeFile(value) {
  const binary = atob(value.dataBase64);
  return new File([Uint8Array.from(binary, c => c.charCodeAt(0))], value.name || '原件', { type: value.type || '', lastModified: value.lastModified || 0 });
}
export async function encodeAttachment(record) {
  const next = { ...record };
  if (record.blob) next.blob = await encodeFile(record.blob);
  if (record.supplements) next.supplements = await Promise.all(record.supplements.map(async item => ({ ...item, blob: await encodeFile(item.blob) })));
  return next;
}
export async function getLedgerAttachment(key) {
  if (!isTauri()) return legacy.getLedgerAttachment(key);
  const record = await invokeTauri('local_data_get_attachment', { key });
  if (!record) return undefined;
  if (record.blob) record.blob = decodeFile(record.blob);
  if (record.supplements) record.supplements = record.supplements.map(item => ({ ...item, blob: decodeFile(item.blob) }));
  return record;
}
export const listLedgerAttachmentMetadata = () => isTauri() ? invokeTauri('local_data_list_attachments') : legacy.listLedgerAttachmentMetadata();
export const listLedgerAttachmentKeys = async () => (await listLedgerAttachmentMetadata()).filter(item => item.hasOriginal).map(item => item.key);
async function put(key, file, mode, metadata = {}) {
  if (!key || !file) throw new Error('缺少原件标识或文件');
  const finish = beginFileWrite();
  try {
    const blob = await encodeFile(file);
    return await invokeTauri('local_data_put_attachment', { key, blob, mode, metadata: { ...metadata, name: file.name || '原件', savedAt: new Date().toISOString(), linkedAt: new Date().toISOString() } });
  } finally { finish(); }
}
export const saveLedgerAttachment = (key, file) => isTauri() ? put(key, file, 'replace') : legacy.saveLedgerAttachment(key, file);
export const saveLedgerAttachmentIfMissing = (key, file) => isTauri() ? put(key, file, 'ifMissing') : legacy.saveLedgerAttachmentIfMissing(key, file);
export const appendInvoiceSupplement = (key, file, metadata) => isTauri() ? put(key, file, 'supplement', metadata) : legacy.appendInvoiceSupplement(key, file, metadata);
export async function deleteUnusedLedgerAttachments(keys, isReferenced) {
  if (!isTauri()) return legacy.deleteUnusedLedgerAttachments(keys, isReferenced);
  const finish = beginFileWrite();
  try {
    // Persist recycle-bin transitions before removing their binary files.
    await flushLocalData();
    const unused = [...new Set(keys)].filter(key => !isReferenced(key));
    if (unused.length) await invokeTauri('local_data_delete_attachments', { keys: unused });
  } finally { finish(); }
}

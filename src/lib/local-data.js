import { reactive } from 'vue';
import { isTauri, invokeTauri } from './platform.js';
import { createDiskStorage, installAppStorage, validateStoredValues } from './app-storage.js';

export const localDataState = reactive({ desktop: isTauri(), root: '', pending: false, error: '', busy: false, fileWrites: 0, migration: '', notice: '', ready: false });
let disk;
let fileWaiters = [];
export function beginFileWrite() {
  if (localDataState.busy) throw new Error('正在备份或恢复，请稍后操作');
  localDataState.fileWrites++;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    localDataState.fileWrites--;
    if (!localDataState.fileWrites) { for (const resolve of fileWaiters) resolve(); fileWaiters = []; }
  };
}
export async function flushLocalData() { await disk?.flush(); }
export async function initializeLocalData(onProgress = () => {}) {
  if (!isTauri()) return;
  let result = await invokeTauri('local_data_init', { boot: true });
  localDataState.root = result.root;
  if (result.loadError) throw new Error(result.loadError + '，请从完整备份恢复');
  if (!result.snapshot) {
    onProgress('正在读取旧台账、档案和设置…');
    const values = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i); values[key] = localStorage.getItem(key);
    }
    validateStoredValues(values);
    const legacy = await import('./legacy-ledger-attachments.js');
    const { encodeAttachment } = await import('./ledger-attachments.js');
    const records = await legacy.listLedgerAttachmentMetadata();
    for (let i = 0; i < records.length; i++) {
      onProgress(`正在迁移原件及附件 ${i + 1} / ${records.length}，请勿关闭软件…`);
      const record = await legacy.getLedgerAttachment(records[i].key);
      if (!record) throw new Error('旧原件读取失败，迁移已停止');
      await invokeTauri('local_data_migrate_record', { record: await encodeAttachment(record) });
    }
    onProgress('正在逐个校验原件并创建首次完整备份…');
    const migration = await invokeTauri('local_data_finish_migration', { values, records: records.length });
    localDataState.migration = `已迁移 ${migration.summary.ledger} 张发票、${migration.summary.payments} 笔付款、${migration.summary.records} 组原件；旧存储已保留。`;
    result = await invokeTauri('local_data_init');
  }
  validateStoredValues(result.snapshot.values);
  disk = createDiskStorage(result.snapshot.values, values => invokeTauri('local_data_save_values', { values }), state => {
    localDataState.pending = state.pending; localDataState.error = state.error;
  });
  installAppStorage(disk);
  localDataState.ready = true;
  window.addEventListener('beforeunload', event => {
    if (disk.pending || disk.error || localDataState.fileWrites || localDataState.busy) { event.preventDefault(); event.returnValue = ''; }
  });
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().onCloseRequested(async event => {
    if (!disk.pending && !disk.error && !localDataState.fileWrites && !localDataState.busy) return;
    event.preventDefault();
    if (localDataState.busy) return;
    try {
      if (localDataState.fileWrites) await new Promise(resolve => fileWaiters.push(resolve));
      await disk.flush();
      await getCurrentWindow().destroy();
    } catch { localDataState.notice = '数据保存失败，已阻止关闭。请重试保存或检查磁盘空间。'; }
  });
}
// Freeze new operations; allow already-started binary writes to finish and flush
// their follow-up metadata before taking the native snapshot.
export async function withLocalDataPaused(operation) {
  if (localDataState.busy) throw new Error('已有数据操作正在进行');
  localDataState.busy = true;
  try {
    if (localDataState.fileWrites) await new Promise(resolve => fileWaiters.push(resolve));
    await new Promise(resolve => setTimeout(resolve, 0));
    disk?.freeze(true);
    await flushLocalData();
    return await operation();
  } finally { disk?.freeze(false); localDataState.busy = false; }
}

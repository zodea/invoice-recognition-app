import { directory, restoreArchive } from './expense-directory.js';
import { toastInfo, toastUndo } from './toast.js';

export function notifyArchiveRemoval(kind, value) {
  const record = directory.deletedArchives.find(item => item.kind === kind && item.value === value);
  if (!record) return;
  toastUndo('已将“' + value + '”移入档案回收站。', () => {
    if (!directory.deletedArchives.includes(record)) { toastInfo('这条回收站记录已处理。'); return; }
    if (kind !== 'aliases' && directory[kind]?.includes(value)) throw new Error('已有同名档案，请在回收站核对。');
    restoreArchive(kind, value);
    toastInfo('已恢复“' + value + '”。');
  });
}

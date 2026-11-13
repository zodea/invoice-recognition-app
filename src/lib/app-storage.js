// Desktop reads are synchronous from the boot snapshot. Complete snapshots are
// serialized to disk; the shell displays pending/error state and guards closing.
// Browser development and existing pure-data tests keep their ordinary storage.
let installed;
export const appStorage = {
  getItem(key) { return (installed || globalThis.localStorage)?.getItem(key) ?? null; },
  setItem(key, value) {
    const target = installed || globalThis.localStorage;
    if (!target) throw new Error('本地存储不可用');
    target.setItem(key, value);
  },
  removeItem(key) { (installed || globalThis.localStorage)?.removeItem(key); },
};

export function installAppStorage(storage) { installed = storage; }

export function createDiskStorage(initial, write, onState = () => {}) {
  const values = new Map(Object.entries(initial));
  let revision = 0, saved = 0, running = null, error = '', frozen = false;
  const state = () => onState({ pending: revision !== saved, error, frozen });
  function writable() {
    if (frozen) throw new Error('正在备份或恢复，请稍后操作');
    if (error) throw new Error('数据尚未写入磁盘，请先重试保存：' + error);
  }
  async function drain() {
    while (saved !== revision) {
      const version = revision, snapshot = Object.fromEntries(values);
      try { await write(snapshot); saved = version; error = ''; }
      catch (cause) { error = String(cause?.message || cause); state(); throw cause; }
      state();
    }
  }
  function start() {
    if (!running) {
      // Coalesce a synchronous multi-key transition into one atomic manifest.
      running = Promise.resolve().then(drain).finally(() => { running = null; });
      running.catch(() => {}); // The persistent shell error is the recovery UI.
    }
    return running;
  }
  return {
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) {
      writable(); key = String(key); value = String(value);
      if (values.get(key) === value) return;
      values.set(key, value); revision++; state(); start();
    },
    removeItem(key) { writable(); if (values.delete(String(key))) { revision++; state(); start(); } },
    async flush() { if (revision !== saved) await start(); if (error) throw new Error(error); },
    freeze(value) { frozen = value; state(); },
    get pending() { return revision !== saved; },
    get error() { return error; },
  };
}

// Reject corrupt known business stores rather than silently loading empty arrays.
export function validateStoredValues(values) {
  const objects = ['invoiceLedger.v1', 'expenseDirectory.v1', 'priceCompareManualGroups', 'expenseAssignmentBackup.v1', 'appSettings.v1'];
  const arrays = ['paymentRecords.v1', 'supplierDb.v1', 'invoiceLedgerTrash.v1', 'invoiceSupplements.v1', 'invoiceLedgerTrashCleanup.v1', 'deliveryPartitions.v1'];
  for (const [key, raw] of Object.entries(values)) {
    if (!objects.includes(key) && !arrays.includes(key)) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error(key + ' 数据格式损坏，旧数据已保留'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== arrays.includes(key)) throw new Error(key + ' 数据结构异常，旧数据已保留');
  }
  return values;
}

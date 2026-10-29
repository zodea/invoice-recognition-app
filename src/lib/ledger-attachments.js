// 发票原件独立于台账文本存储，避免大型文件占满 localStorage。
const DB_NAME = "invoice-ledger-files";
const STORE = "attachments";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run(mode, operation) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("原件保存中断"));
    });
  } finally { db.close(); }
}

export const getLedgerAttachment = (key) => run("readonly", store => store.get(key));
export const listLedgerAttachmentKeys = () => run("readonly", store => store.getAllKeys());
export function saveLedgerAttachment(key, file) {
  if (!key || !file) throw new Error("缺少发票号码或原件");
  return run("readwrite", store => store.put({ key, name: file.name || "发票原件", blob: file, savedAt: new Date().toISOString() }));
}

// 在同一个事务中检查并写入，自动同步不能替换用户已关联的原件。
export async function saveLedgerAttachmentIfMissing(key, file) {
  if (!key || !file) throw new Error("缺少发票号码或原件");
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.getKey(key);
      let saved = false;
      get.onsuccess = () => {
        if (get.result !== undefined) return;
        store.add({ key, name: file.name || "发票原件", blob: file, savedAt: new Date().toISOString() });
        saved = true;
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("原件保存中断"));
    });
  } finally { db.close(); }
}

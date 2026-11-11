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
export const listLedgerAttachmentKeys = async () => (await run("readonly", store => store.getAll())).filter(item => item.blob).map(item => item.key);
export async function deleteUnusedLedgerAttachments(keys, isReferenced) {
  if (!keys.length) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('原件清理中断，可重试'));
      try {
        for (const key of new Set(keys)) if (!isReferenced(key)) tx.objectStore(STORE).delete(key);
      } catch (error) { tx.abort(); reject(error); }
    });
  } finally { db.close(); }
}
export function saveLedgerAttachment(key, file) {
  if (!key || !file) throw new Error("缺少发票号码或原件");
  return updateAttachment(key, previous => ({ ...previous, key, name: file.name || "发票原件", blob: file, savedAt: new Date().toISOString() }));
}

async function updateAttachment(key, change) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite'), store = tx.objectStore(STORE);
      let result, failure;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure || tx.error);
      tx.onabort = () => reject(failure || tx.error || new Error('原件保存中断'));
      const request = store.get(key);
      request.onsuccess = () => {
        try { result = change(request.result || { key }); store.put(result); }
        catch (error) { failure = error; tx.abort(); }
      };
    });
  } finally { db.close(); }
}

// 行程单随主发票原件一起存储、恢复和清理，不单独建立金额记录。
export function appendInvoiceSupplement(key, file, metadata) {
  if (!key || !file || !metadata.hash) throw new Error('缺少主发票、附件或内容标识');
  return updateAttachment(key, previous => {
    const supplements = previous.supplements || [];
    if (supplements.some(item => item.hash === metadata.hash)) return previous;
    return { ...previous, supplements: [...supplements, { ...metadata, name: file.name || '行程单附件', blob: file, linkedAt: new Date().toISOString() }] };
  });
}

// 在同一个事务中检查并写入，自动同步不能替换用户已关联的原件。
export async function saveLedgerAttachmentIfMissing(key, file) {
  if (!key || !file) throw new Error("缺少发票号码或原件");
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(key);
      let saved = false;
      get.onsuccess = () => {
        if (get.result?.blob) return;
        store.put({ ...(get.result || {}), key, name: file.name || "发票原件", blob: file, savedAt: new Date().toISOString() });
        saved = true;
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("原件保存中断"));
    });
  } finally { db.close(); }
}

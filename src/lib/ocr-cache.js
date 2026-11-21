const CACHE_VERSION = 'ocr-v2';
const LIMIT = 2000;
let opening;

function openCache() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('invoice-ocr-cache', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('results', { keyPath: 'key' });
        store.createIndex('ts', 'ts');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => { opening = undefined; throw error; });
  }
  return opening;
}

// 读、更新时间和淘汰均在同一读写事务里完成。存储不可用时仍正常识别。
async function access(sha256, value) {
  if (!sha256) return null;
  try {
    const db = await openCache();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('results', 'readwrite');
      const store = tx.objectStore('results');
      const key = CACHE_VERSION + ':' + sha256;
      let result = null;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
      if (value === undefined) {
        const request = store.get(key);
        request.onsuccess = () => {
          result = request.result || null;
          if (result) store.put({ ...result, ts: Date.now() });
        };
      } else {
        store.put({ ...value, key, modelVersion: CACHE_VERSION, ts: Date.now() });
        const count = store.count();
        count.onsuccess = () => {
          let excess = count.result - LIMIT;
          if (excess <= 0) return;
          const oldest = store.index('ts').openKeyCursor();
          oldest.onsuccess = () => {
            const cursor = oldest.result;
            if (!cursor) return;
            store.delete(cursor.primaryKey);
            if (--excess > 0) cursor.continue();
          };
        };
      }
    });
  } catch { return null; }
}

export const getOcrCache = sha256 => access(sha256);
export const putOcrCache = (sha256, result) => access(sha256, result);

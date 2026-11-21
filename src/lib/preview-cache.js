// 只管理高清预览生成的 URL。原图、OCR 临时页和打印附件由各自的调用方释放。
const pages = new Map();
const fileIds = new WeakMap();
let nextId = 0;
const limit = 8;

export function previewKey(file, page, rotation, width) {
  if (!fileIds.has(file)) fileIds.set(file, ++nextId);
  return [fileIds.get(file), page, rotation, width].join('/');
}

export function discardFilePreviews(file) {
  const id = fileIds.get(file);
  if (!id) return;
  fileIds.delete(file);
  for (const [key, entry] of pages) {
    if (!key.startsWith(id + '/')) continue;
    pages.delete(key);
    entry.discarded = true;
    if (!entry.users && entry.url) URL.revokeObjectURL(entry.url);
  }
}

function evict() {
  for (const [key, entry] of pages) {
    if (pages.size <= limit) break;
    if (entry.users || !entry.url) continue;
    URL.revokeObjectURL(entry.url);
    pages.delete(key);
  }
}

export async function acquirePreview(key, render) {
  let entry = pages.get(key);
  if (entry) pages.delete(key);
  else {
    entry = { users: 0, url: '', ready: null };
    entry.ready = Promise.resolve().then(render).then(url => {
      if (!url) throw new Error('无法生成预览');
      entry.url = url;
      return url;
    }).catch(error => { pages.delete(key); throw error; });
  }
  pages.set(key, entry);
  entry.users++;
  const url = await entry.ready;
  evict();
  let released = false;
  return { url, release() {
    if (released) return;
    released = true;
    entry.users--;
    if (entry.discarded && !entry.users) URL.revokeObjectURL(url);
    evict();
  } };
}

import assert from 'node:assert/strict';
import { acquirePreview, discardFilePreviews, previewKey } from '../src/lib/preview-cache.js';

const file = new Blob(['preview test']);
const raw = URL.createObjectURL(file);
const make = () => URL.createObjectURL(file);
const key = page => previewKey(file, page, 0, 768);
try {
  const [first, second] = await Promise.all([
    acquirePreview(key(1), make),
    acquirePreview(key(1), () => assert.fail('duplicate render')),
  ]);
  assert.equal(first.url, second.url);
  first.release();
  first.release();
  const urls = [];
  for (let page = 2; page <= 36; page++) {
    const item = await acquirePreview(key(page), make);
    urls.push(item.url);
    item.release();
  }
  assert.equal((await fetch(second.url)).status, 200);
  second.release();
  let live = 0;
  for (const url of urls) {
    try { await fetch(url); live++; } catch { /* evicted */ }
  }
  assert.equal(live, 7, 'active page and seven recent pages fit the limit');
  const [recent] = urls.slice(-1);
  const reused = await acquirePreview(key(36), () => assert.fail('recent page rerendered'));
  assert.equal(reused.url, recent);
  reused.release();
  const retryKey = previewKey(file, 2, 90, 1024);
  await assert.rejects(acquirePreview(retryKey, () => Promise.reject(new Error('render failed'))));
  const retry = await acquirePreview(retryKey, make);
  retry.release();
  const activePage = await acquirePreview(key(36), make);
  let finish;
  const pending = acquirePreview(key(40), () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  discardFilePreviews(file);
  await assert.rejects(fetch(retry.url), '清空时回收空闲缓存');
  assert.equal((await fetch(activePage.url)).status, 200, '保留其他视图仍在使用的同一页');
  activePage.release();
  await assert.rejects(fetch(activePage.url));
  finish(make());
  const late = await pending;
  late.release();
  await assert.rejects(fetch(late.url), '清空后才完成的预览也能释放');
  assert.equal(await (await fetch(raw)).text(), 'preview test');
} finally { URL.revokeObjectURL(raw); }
console.log('高清预览 36 页逐项淘汰、并发复用、占用保护、失败重试与原图隔离通过');

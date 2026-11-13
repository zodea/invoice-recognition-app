import assert from 'node:assert/strict';
import { createDiskStorage, validateStoredValues, installAppStorage, appStorage } from '../src/lib/app-storage.js';
import { encodeAttachment, decodeFile } from '../src/lib/ledger-attachments.js';

let writes = [], release;
const states = [];
const store = createDiskStorage({ ledger: 'old' }, async values => {
  writes.push(values);
  if (writes.length === 1) await new Promise(resolve => { release = resolve; });
}, state => states.push(state));
store.setItem('trash', 'backup'); store.setItem('ledger', 'new'); store.setItem('trash', 'final');
await Promise.resolve();
assert.equal(writes.length, 1);
assert.deepEqual(writes[0], { ledger: 'new', trash: 'final' }, '同步多键变更必须整套提交');
store.setItem('later', 'another change');
release(); await store.flush();
assert.equal(writes.length, 2);
assert.equal(writes[1].later, 'another change', '写入中新增的修改必须继续落盘');
assert.equal(store.pending, false);
assert.equal(states.at(-1).pending, false);

let fail = true, saved;
const retry = createDiskStorage({ a: 'old' }, async values => { if (fail) throw new Error('磁盘已满'); saved = values; });
retry.setItem('a', 'new');
await assert.rejects(retry.flush(), /磁盘已满/);
assert.equal(retry.pending, true);
assert.equal(retry.getItem('a'), 'new', '写入失败保留内存中的待保存数据');
assert.throws(() => retry.setItem('b', 'blocked'), /请先重试/);
fail = false; await retry.flush();
assert.deepEqual(saved, { a: 'new' });
retry.freeze(true); assert.throws(() => retry.setItem('a', 'bad'), /正在备份/);
retry.freeze(false); retry.removeItem('a'); await retry.flush(); assert.deepEqual(saved, {});

globalThis.localStorage = { getItem: () => 'legacy', setItem: () => { throw new Error('不得写旧存储'); } };
installAppStorage(store); appStorage.setItem('portable', 'disk only'); await store.flush();
assert.equal(appStorage.getItem('portable'), 'disk only');
installAppStorage(undefined); delete globalThis.localStorage;
for (const value of ['bad', '[]', 'null', '3']) assert.throws(() => validateStoredValues({ 'invoiceLedger.v1': value }));
assert.throws(() => validateStoredValues({ 'paymentRecords.v1': '{}' }));
assert.deepEqual(validateStoredValues({ 'invoiceLedger.v1': '{}', 'paymentRecords.v1': '[]', invoiceFilenameTemplate: '{销售方}' }), { 'invoiceLedger.v1': '{}', 'paymentRecords.v1': '[]', invoiceFilenameTemplate: '{销售方}' });
const file = new File([new Uint8Array([0, 255, 127, 3])], '中文凭证.pdf', { type: 'application/pdf', lastModified: 1234 });
const original = { key: 'receipt', blob: file, extra: { preserve: true }, supplements: [{ hash: 'abc', blob: file, custom: 7 }] };
const encoded = await encodeAttachment(original);
assert.equal(encoded.extra.preserve, true); assert.equal(encoded.supplements[0].custom, 7);
const decoded = decodeFile(encoded.blob);
assert.equal(decoded.name, file.name); assert.equal(decoded.type, file.type); assert.equal(decoded.lastModified, 1234);
assert.deepEqual(await decoded.arrayBuffer(), await file.arrayBuffer());
assert.equal(original.blob, file, '迁移编码不得修改旧原件');
console.log('本地存储整套提交、并发更新、磁盘失败重试、冻结、旧存储保护、坏数据拦截及二进制迁移往返验证通过');

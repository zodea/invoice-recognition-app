import assert from 'node:assert/strict';
import { ledgerTrashKey, readLedgerTrashForChange } from '../src/lib/ledger-trash.js';
import { planTrashPurge, persistTrashPurge, readTrashCleanupQueue, cleanupPurgedAttachments } from '../src/lib/ledger-trash-purge.js';

const records = [
  { id: 'a1', key: 'a', entry: { total: 100 } },
  { id: 'a2', key: 'a', entry: { total: 200 } },
  { id: 'b1', key: 'b', entry: { total: 300 } },
];
assert.deepEqual(planTrashPurge({}, records, ['a1']).cleanupKeys, [], '同号其他回收站记录仍引用原件');
assert.deepEqual(planTrashPurge({ a: {} }, records, ['a1', 'a2']).cleanupKeys, [], '有效台账仍引用原件');
const plan = planTrashPurge({}, records, ['a1', 'a2', 'a1', 'missing']);
assert.equal(plan.changed, 2);
assert.deepEqual(plan.cleanupKeys, ['a']);
assert.equal(plan.trash[0].id, 'b1');
assert.equal(records.length, 3, '不修改输入记录');
assert.deepEqual(planTrashPurge({}, records, records.map(r => r.id)).trash, []);

const memory = new Map([[ledgerTrashKey, JSON.stringify(records)]]);
const storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) };
persistTrashPurge(plan, storage);
assert.equal(readLedgerTrashForChange(storage).length, 1);
assert.deepEqual(readTrashCleanupQueue(storage), ['a']);
await assert.rejects(cleanupPurgedAttachments(() => ({}), async () => { throw Error('原件存储失败'); }, storage));
assert.deepEqual(readTrashCleanupQueue(storage), ['a'], '失败保留重试队列');
const deleted = [];
await cleanupPurgedAttachments(() => ({}), async (keys, referenced) => {
  for (const key of keys) if (!referenced(key)) deleted.push(key);
}, storage);
assert.deepEqual(deleted, ['a']);
assert.deepEqual(readTrashCleanupQueue(storage), []);

// 回收站写入失败：记录仍存在，重试清理也不能删除它的原件。
storage.setItem(ledgerTrashKey, JSON.stringify(records));
const failedStorage = { ...storage, setItem(k, v) { if (k === ledgerTrashKey) throw Error('写入失败'); storage.setItem(k, v); } };
assert.throws(() => persistTrashPurge(plan, failedStorage));
assert.equal(readLedgerTrashForChange(storage).length, 3);
await cleanupPurgedAttachments(() => ({}), async (keys, referenced) => {
  assert.ok(keys.every(referenced));
}, storage);

// 清理前重新导入/恢复同号记录，必须读取最新引用而非旧快照。
persistTrashPurge(plan, storage);
let active = {};
await cleanupPurgedAttachments(() => active, async (keys, referenced) => {
  active = { a: { total: 999 } };
  assert.ok(referenced(keys[0]));
}, storage);
assert.deepEqual(readTrashCleanupQueue(storage), []);
const before = storage.getItem(ledgerTrashKey);
assert.throws(() => persistTrashPurge(plan, { ...storage, setItem() { throw Error('空间不足'); } }));
assert.equal(storage.getItem(ledgerTrashKey), before, '队列保存失败不能修改回收站');
assert.throws(() => readTrashCleanupQueue({ getItem: () => '{invalid' }));
assert.throws(() => readTrashCleanupQueue({ getItem: () => '[null]' }));
console.log('永久删除、同号原件保护、清空、保存失败和清理重试测试通过');

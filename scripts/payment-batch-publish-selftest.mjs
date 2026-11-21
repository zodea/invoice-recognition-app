import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const enteredLast = Promise.withResolvers();
const finishLast = Promise.withResolvers();
const recognized = [];
globalThis.__recognizeBatchFixture = async (file, { onProgress }) => {
  recognized.push(file.name);
  onProgress('识别图片内容');
  if (file.name === 'last.png') {
    enteredLast.resolve();
    await finishLast.promise;
  }
  return { file, fields: { date: '2026-03-02' }, pages: [{ text: '相同收据文字' }], warnings: [] };
};
const mock = 'data:text/javascript,' + encodeURIComponent(
  'export const recognizePaymentEvidenceFile = (...args) => globalThis.__recognizeBatchFixture(...args);',
);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === '../lib/payment-evidence-import.js' ? { url: mock, shortCircuit: true } : next(specifier, context);
  },
});
const { usePaymentBatch } = await import('../src/composables/usePaymentBatch.js');
hooks.deregister();

const publications = [];
const batch = usePaymentBatch({ existingRows: [], period: '', saving: false }, (event, value) => {
  assert.equal(event, 'evidence');
  publications.push(value);
});
const image = (bytes, name) => new File([bytes], name, { type: 'image/png' });
await batch.prepare([image('first', 'first.png')]);
const before = batch.evidence.value;
const appended = batch.prepare([
  image('first', 'copy.png'),
  image('another', 'another.png'),
  image('last', 'last.png'),
]);
try {
  await enteredLast.promise;
  assert.equal(batch.busy.value, true);
  assert.equal(batch.queue.value[1].state, '重复副本');
  assert.equal(batch.queue.value[2].state, '已识别');
  assert.equal(batch.queue.value[3].state, '识别中');
  assert.equal(batch.evidence.value, before, '识别中保留上一批次的核对预览');
  assert.equal(publications.length, 1);
} finally {
  finishLast.resolve();
  await appended;
  delete globalThis.__recognizeBatchFixture;
}
assert.equal(batch.busy.value, false);
assert.equal(batch.progress.text, '');
assert.equal(publications.length, 2, '追加批次仅发布一次');
assert.deepEqual(recognized, ['first.png', 'another.png', 'last.png']);
assert.deepEqual(before[0].paths, ['first.png']);
assert.deepEqual(batch.evidence.value[0].paths, ['first.png', 'copy.png']);
assert.equal(batch.evidence.value[1].duplicateHint, '与 first.png 识别文字相同');
assert.equal(batch.evidence.value[2].duplicateHint, '与 first.png 识别文字相同');
console.log('付款凭证逐张进度、批次发布和跨批次重复副本索引测试通过');

// 规范命名的截图在推理未返回时就能核对。不能据文件名推断支付成功。
const started = Promise.withResolvers(), finish = Promise.withResolvers();
globalThis.__recognizeBatchFixture = async file => {
  started.resolve();
  await finish.promise;
  return { file, fields: { transactionId: 'TX-123' }, pages: [{text: '交易单号 TX-123'}], warnings: [] };
};
const namedBatch = usePaymentBatch({ existingRows: [], period: '', saving: false }, () => {});
const namedFile = image('named', '2026-10-06-测试商户-3200.00元.PNG');
const processing = namedBatch.prepare([namedFile]);
try {
  await started.promise;
  assert.equal(namedBatch.busy.value, true);
  assert.equal(namedBatch.queue.value[0].filenameDraft, true);
  assert.deepEqual(namedBatch.evidence.value[0].fields, {date:'2026-10-06',seller:'测试商户',total:'3200.00'});
} finally {
  finish.resolve();
  await processing;
  delete globalThis.__recognizeBatchFixture;
}
assert.equal(namedBatch.evidence.value[0].fields.transactionId, 'TX-123');
assert.equal(namedBatch.evidence.value[0].fields.seller, '测试商户');

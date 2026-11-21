import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { downscaleImageForOcr } from '../src/lib/ocr.js';
import { paymentScreenshotDraft } from '../src/lib/invoice-filename.js';

const drawn = [];
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage: (...args) => drawn.push(args) }) }) };
const small = { width: 1600, height: 500 };
assert.equal(downscaleImageForOcr(small), small);
const scaled = downscaleImageForOcr({ naturalWidth: 3000, naturalHeight: 4000 });
assert.deepEqual([scaled.width, scaled.height], [1200, 1600]);
assert.equal(drawn.length, 1);
assert.deepEqual(paymentScreenshotDraft('2026-10-06-测试-32.00元.PNG'), { date: '2026-10-06', seller: '测试', total: '32.00' });
assert.equal(paymentScreenshotDraft('2026-02-30-测试-32.00元.PNG'), null);
assert.equal(paymentScreenshotDraft('2026-10-06-测试-32.00元-行程单.png'), null);

const scans = [], crops = [], cache = new Map(), renders = [];
let amount = '12.34', medical = false, failPage = null;
globalThis.fixture = {
  async recognizePages([page], _, options) {
    scans.push(page.pageIndex);
    if (page.pageIndex === failPage) throw Error('page unavailable');
    options.onPageRegions?.([{ page: page.pageIndex, text: '识别位置' }]);
    if (medical) return ['医疗门诊收费票据', '小写 12.34'];
    return page.pageIndex ? ['第 ' + (page.pageIndex + 1) + ' 页明细'] : ['增值税普通发票', '发票号码 12345678', '价税合计（小写）￥' + amount];
  },
  async recognizePageRegion(page) { crops.push(page.dataUrl); return ['票据号码：0012345678']; },
  async extractPdfText() { return { text: '', regions: [], numPages: 3 }; },
  async renderPdfPages(_, options) {
    renders.push(options);
    return Array.from({ length: options.maxPages }, (_, i) => 'blob:' + options.scale + '/' + ((options.firstPage || 1) + i));
  },
  async getOcrCache(key) { return cache.get(key); },
  async putOcrCache(key, value) { cache.set(key, structuredClone(value)); },
};
const mocks = {
  './lib/ocr': 'export const {recognizePages,recognizePageRegion}=globalThis.fixture; export const yieldToBackground=()=>Promise.resolve();',
  './lib/pdftext': 'export const {extractPdfText,renderPdfPages}=globalThis.fixture; export const imgNaturalSize=()=>({}); export const rotateImageUrl=u=>u;',
  './lib/ocr-cache.js': 'export const {getOcrCache,putOcrCache}=globalThis.fixture;',
};
const hooks = registerHooks({ resolve(spec, context, next) {
  if (Object.hasOwn(mocks,spec)) return { url: 'data:text/javascript,' + encodeURIComponent(mocks[spec]), shortCircuit: true };
  if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(spec + '.js',context);
  return next(spec,context);
}});
const { invoiceActions: actions, invoiceStore: store } = await import('../src/invoiceStore.js');
hooks.deregister();

async function add(name, bytes) {
  await actions.addFiles([new File([bytes], name, { type: 'application/pdf' })]);
  return store.invoices.at(-1);
}
const first = await add('发票.pdf', 'synthetic-scan');
await actions.recognizeOne(first, { skipDedupe: true });
assert.equal(first.fields.number, '12345678');
assert.equal(first.fields.total, 12.34);
assert.deepEqual(scans, [0]);
assert.deepEqual(first.lastRecognition.remainingPages, [2,3]);
assert.ok(renders.some(opts => opts.scale === 2.2 && opts.maxPixels === 2_200_000 && opts.maxPages === 2));

actions.clearAll();
const again = await add('改名.pdf', 'synthetic-scan');
await actions.recognizeOne(again, { skipDedupe: true });
assert.deepEqual(scans, [0], '同内容改名后仍命中缓存');
assert.deepEqual(again.recognitionRegions, first.recognitionRegions);
again.fields.seller = '人工核对';
amount = '56.78';
await actions.recognizeOne(again, { skipDedupe: true, force: true });
assert.equal(again.fields.total, 56.78);
assert.equal(again.fields.seller, '人工核对');
assert.equal(cache.get(again.sha256).parsedFields.seller, '');
assert.deepEqual(scans, [0,0]);

failPage = 1;
await actions.recognizeOne(again, { skipDedupe: true, remaining: true });
assert.deepEqual(again.lastRecognition.remainingPages, [2]);
assert.deepEqual(scans, [0,0,1,2]);
failPage = null;
await actions.recognizeOne(again, { skipDedupe: true, remaining: true });
assert.deepEqual(again.lastRecognition.remainingPages, []);
assert.deepEqual(scans, [0,0,1,2,1]);
assert.deepEqual(again.recognitionRegions.map(r => r.page).sort(), [0,1,2]);
assert.equal(again.fields.seller, '人工核对');
assert.match(again.rawText, /第 2 页明细/);

const details = await add('行程及费用明细.pdf','details');
await actions.recognizeOne(details, { skipDedupe: true });
assert.deepEqual(scans.slice(-3), [0,1,2]);
medical = true;
const receipt = await add('2026-10-06-测试医院-12.34元-医疗票据.pdf','medical');
await actions.recognizeOne(receipt, { skipDedupe: true });
assert.deepEqual(crops, ['blob:3/1']);
assert.equal(receipt.fields.number, '0012345678');
actions.clearAll();
console.log('高清缩图、扫描件早停、失败页补扫、持久缓存接口、强制重跑和医疗票高清补扫通过');

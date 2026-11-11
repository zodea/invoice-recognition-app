import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// 替换 PDF 引擎，以公开入口验证失败、超时与成功时的资源释放，不需要真实票据或浏览器。
const mockModule = 'data:text/javascript,' + encodeURIComponent(`
  export const GlobalWorkerOptions = {};
  export function getDocument() { return { promise: Promise.resolve(globalThis.__pdfTestDocument) }; }
`);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === 'pdfjs-dist' ? { url: mockModule, shortCircuit: true } : next(specifier, context);
  },
});
const { extractPdfText, renderPdfPages } = await import('../src/lib/pdftext.js');
hooks.deregister();

let destroyed = 0, cleaned = 0, canceled = 0;
const requestedPages = [], viewports = [], formats = [];
const file = new Blob(['test']);
const page = {
  cleanup() { cleaned++; },
  getViewport({ scale, rotation }) { viewports.push({ scale, rotation }); return { width: 200 * scale, height: 100 * scale }; },
  async getTextContent() { throw new Error('文字读取失败'); },
};
globalThis.__pdfTestDocument = { numPages: 1, getPage: async number => { requestedPages.push(number); return page; }, destroy: async () => { destroyed++; } };
const originalDocument = globalThis.document;
const originalCreateURL = URL.createObjectURL;
const originalTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const activeTimers = new Set(), canvases = [];
try {
  await assert.rejects(extractPdfText(file), /文字读取失败/);
  assert.equal(cleaned, 1);
  assert.equal(destroyed, 1);
  page.getTextContent = async () => ({ items: [{ str: '测试', transform: [1, 0, 0, 1, 0, 1] }] });
  assert.equal((await extractPdfText(file)).text, '测试');
  assert.equal(cleaned, 2);
  assert.equal(destroyed, 2);

  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, getContext: () => ({}), toBlob(callback, type) { formats.push(type); callback(new Blob(['preview'])); } };
    canvases.push(canvas);
    return canvas;
  } };
  URL.createObjectURL = () => 'blob:preview';
  globalThis.setTimeout = (callback, delay) => {
    const timer = originalTimeout(() => { activeTimers.delete(timer); callback(); }, delay);
    activeTimers.add(timer);
    return timer;
  };
  globalThis.clearTimeout = timer => { activeTimers.delete(timer); originalClearTimeout(timer); };
  const task = promise => ({ promise, cancel() { canceled++; } });

  page.render = () => task(Promise.reject(new Error('渲染失败')));
  assert.deepEqual(await renderPdfPages(file), [null]);
  assert.equal(activeTimers.size, 0, '渲染失败后清除超时计时器');
  assert.equal(cleaned, 3);
  assert.equal(destroyed, 3);

  page.render = () => task(new Promise(() => {}));
  assert.deepEqual(await renderPdfPages(file, { timeoutMs: 5 }), [null]);
  assert.equal(canceled, 1);
  assert.equal(cleaned, 4);
  assert.equal(destroyed, 4);

  page.render = () => task(Promise.resolve());
  assert.deepEqual(await renderPdfPages(file), ['blob:preview']);
  assert.equal(cleaned, 5);
  assert.equal(destroyed, 5);
  assert.equal(activeTimers.size, 0);
  assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), '每页结束后释放画布内存');
  globalThis.__pdfTestDocument.numPages = 20;
  requestedPages.length = 0;
  await renderPdfPages(file, { firstPage: 7, maxPages: 1, targetWidth: 1600, rotation: 90 });
  assert.deepEqual(requestedPages, [7], '高清查看只渲染指定页面，不遍历整份 PDF');
  assert.deepEqual(viewports.at(-1), { scale: 8, rotation: 90 });
  assert.ok(formats.every(type => type === 'image/png'), '文字预览使用无损 PNG');
} finally {
  for (const timer of activeTimers) originalClearTimeout(timer);
  globalThis.setTimeout = originalTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  URL.createObjectURL = originalCreateURL;
  delete globalThis.__pdfTestDocument;
}
console.log('PDF 文字抽取、预览成功、失败和超时的资源释放检查通过');

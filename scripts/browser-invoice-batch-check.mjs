import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { preview } from 'vite';

const { chromium } = await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
const app = await preview({
  configFile: false, logLevel: 'silent', build: { outDir: path.resolve(process.argv[2] || 'dist') },
  preview: { host: '127.0.0.1', port: 0, open: false },
});
const directory = await mkdtemp(path.join(tmpdir(), 'invoice-batch-'));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_TEST_EXECUTABLE, headless: true });
  const maker = await browser.newPage();
  await maker.setContent('<meta charset="utf-8"><h1>电子发票（普通发票）</h1><p id="number"></p><p>开票日期：2026年11月10日</p><p>购买方名称：测试采购公司</p><p>销售方名称：样例供应商</p><p>价税合计（小写）￥1234.56</p>');
  const files = [];
  for (let i = 0; i < 200; i++) {
    const number = '26123456789012345' + String(i).padStart(3, '0');
    await maker.locator('#number').evaluate((el, value) => { el.textContent = '发票号码：' + value; }, number);
    const file = path.join(directory, number + '.pdf');
    await maker.pdf({ path: file, format: 'A4' });
    files.push(file);
  }
  await maker.close();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const cdp = await page.context().newCDPSession(page);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(request.failure().errorText));
  page.on('response', response => { if (response.status() >= 400) errors.push(String(response.status())); });
  await page.addInitScript(() => {
    const urls = new Set(), canvases = [];
    const stats = window.batchCheck = { urls, canvases, workers: 0, peakWorkers: 0, frames: [], measuring: false };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      canvases.push(new WeakRef(this));
      return toBlob.apply(this, args);
    };
    window.Worker = class extends Worker {
      constructor(...args) { super(...args); stats.peakWorkers = Math.max(stats.peakWorkers, ++stats.workers); }
      terminate() { stats.workers--; return super.terminate(); }
    };
    document.addEventListener('change', event => {
      if (event.target.type !== 'file') return;
      stats.frames = [];
      stats.peakWorkers = stats.workers;
      stats.measuring = true;
      stats.startedAt = performance.now();
      let previous = stats.startedAt;
      function frame(now) {
        if (!stats.measuring) return;
        if (now > previous) { stats.frames.push(now - previous); previous = now; }
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }, true);
  });
  await page.goto('http://127.0.0.1:' + app.httpServer.address().port);
  const upload = page.locator('.invoice-upload-actions input[type=file]').first();
  const pager = page.getByRole('navigation', { name: '票据列表分页' });
  for (const run of ['首次导入', '清空后再次导入']) {
    await upload.setInputFiles(files);
    await pager.getByRole('button', { name: '下一页' }).waitFor();
    // Time the actual button handler through the next paint while the batch is running.
    const pageTimes = [];
    for (const name of ['下一页', '上一页', '下一页', '上一页']) {
      pageTimes.push(await pager.getByRole('button', { name }).evaluate(async button => {
        const previous = document.querySelector('[data-inv-list]').dataset.invList;
        const start = performance.now();
        button.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (previous === document.querySelector('[data-inv-list]').dataset.invList) throw Error('翻页未切换票据');
        return performance.now() - start;
      }));
    }
    await page.waitForFunction(() => document.querySelector('.invoice-list .ui-section-header')?.textContent.includes('200 张') &&
      !document.querySelector('.batch-progress'), null, { timeout: 180000 });
    assert.equal(await page.locator('[data-inv-list]').count(), 20);
    assert.equal(await pager.locator('span').innerText(), '1 / 10');
    await page.waitForFunction(() => document.querySelector('.document-page img')?.naturalWidth > 0);
    const timing = await page.evaluate(() => {
      batchCheck.measuring = false;
      const frames = batchCheck.frames.toSorted((a, b) => a - b);
      return { elapsedMs: performance.now() - batchCheck.startedAt, frameP95: frames[Math.floor(frames.length * .95)],
        maxFrame: frames.at(-1), peakWorkers: batchCheck.peakWorkers };
    });
    await page.getByRole('button', { name: '筛选与入账', exact: true }).click();
    assert.doesNotMatch(await page.getByText(/本批识别结束/).innerText(), /未识别成功|自动移除/);
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-inv-list]') && !batchCheck.urls.size && !batchCheck.workers);
    await cdp.send('HeapProfiler.collectGarbage');
    const remaining = await page.evaluate(() => ({
      urls: batchCheck.urls.size, workers: batchCheck.workers,
      canvases: batchCheck.canvases.filter(ref => ref.deref()?.width && ref.deref()?.height).length,
    }));
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    console.log(JSON.stringify({ run, ...timing, pageTimes, remaining, heapAfterClear: usedSize }));
    assert.ok(timing.peakWorkers > 0 && timing.peakWorkers <= 2);
    assert.deepEqual(remaining, { urls: 0, workers: 0, canvases: 0 });
    assert.ok(timing.frameP95 <= 34 && timing.maxFrame <= 100 && Math.max(...pageTimes) <= 100, '导入期间的帧间隔或翻页响应超限');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  await new Promise(resolve => app.httpServer.close(resolve));
  await rm(directory, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import path from 'node:path';
import { preview } from 'vite';

const { chromium } = await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
const app = await preview({
  configFile: false, logLevel: 'silent', build: { outDir: path.resolve(process.argv[2] || 'dist') },
  preview: { host: '127.0.0.1', port: 0, open: false },
});
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_TEST_EXECUTABLE, headless: true });
  const samples = [];
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
    page.on('requestfailed', request => errors.push(request.url()));
    page.on('response', response => { if (response.status() >= 400) errors.push(response.url()); });
    await page.addInitScript(() => {
      const ledger = {};
      const suppliers = Array.from({ length: 12 }, (_, i) => ({ id: 'fixture-' + i, name: '样例供应商' + String(i + 1).padStart(2, '0'), aliases: [], attachments: [], type: '材料供应商' }));
      for (let i = 0; i < 60; i++) {
        const number = String(26110000 + i);
        ledger[number] = { key: number, number, code: '1234567890', buyer: '测试采购公司', seller: suppliers[i % suppliers.length].name,
          total: 120 + i, amount: 100 + i, tax: 20, date: '2026-11-10', type: '普通发票', docType: '增值税发票', verified: false, printed: false, batches: [] };
      }
      localStorage.setItem('invoiceLedger.v1', JSON.stringify(ledger));
      localStorage.setItem('supplierDb.v1', JSON.stringify(suppliers));
      localStorage.setItem('expenseDirectory.v1', JSON.stringify({ buyers: ['测试采购公司'], projects: ['测试工地甲', '测试工地乙'], rules: [], allocations: ['公司开支'] }));
      function checkWorkspace() {
        const tab = document.querySelector('.app-navigation [role=tab][aria-selected=true]');
        const panel = tab && document.getElementById(tab.getAttribute('aria-controls'));
        if (panel?.querySelector('.invoice-document')?.getBoundingClientRect().height > 0) {
          requestAnimationFrame(() => { window.invoiceHomeReady = performance.now(); });
        } else requestAnimationFrame(checkWorkspace);
      }
      requestAnimationFrame(checkWorkspace);
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 10e6 / 8, uploadThroughput: 10e6 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('http://127.0.0.1:' + app.httpServer.address().port, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.invoiceHomeReady > 0);
    await page.waitForLoadState('networkidle');
    const sample = await page.evaluate(() => {
      const assets = performance.getEntriesByType('resource').filter(entry => /\.(js|css)$/.test(new URL(entry.name).pathname));
      return { ms: window.invoiceHomeReady, bytes: assets.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
        heavy: assets.map(entry => new URL(entry.name).pathname).filter(file => /vendor-(pdf|xlsx|table|ocr)/.test(file)) };
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(sample.heavy, [], '首页提前请求了大型依赖');
    samples.push(sample);
    await context.close();
  }
  const medianMs = samples.map(sample => sample.ms).sort((a, b) => a - b)[1];
  console.log(JSON.stringify({ samples, medianMs }));
  assert.ok(medianMs <= 860, '受限首屏三次中位数超过 860 ms');
} finally {
  await browser?.close();
  await new Promise(resolve => app.httpServer.close(resolve));
}

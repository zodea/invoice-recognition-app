import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium } = await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const browser = await chromium.launch({ executablePath: process.env.BROWSER_TEST_EXECUTABLE, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('expenseDirectory.v1', JSON.stringify({ buyers: ['合成购买方'], projects: ['合成工地'], rules: [] })));
  await page.goto(process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__inv?.invoiceStore);
  const initial = await page.evaluate(async () => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    const number = '26990000000000000001';
    const date = new Date().toISOString().slice(0, 10);
    const entry = { number, seller: '合成商户', buyer: '合成购买方', type: '普通发票', docType: '增值税发票', date, amount: 100, tax: 6, total: 106 };
    store.ledger = { site: { ...entry, number: '8888', key: 'site', project: '合成工地' } };
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/6ZkAAAAASUVORK5CYII='), c => c.charCodeAt(0));
    const create = (id, fields) => {
      const file = new File([bytes], id+'.png', { type: 'image/png' });
      const url = URL.createObjectURL(file);
      return { id, name: file.name, blob: file, kind: 'image', pages: [{ dataUrl: url, width: 1, height: 1 }], renderedPages: [url], rotation: 0, pageCount: 1, fields: { ...fields }, status: 'done', history: {}, include: true };
    };
    store.invoices = [create('first', entry), create('copy', entry), create('last', { ...entry, number: '26990000000000000002' })];
    store.selectedId = 'copy';
    actions.refreshDuplicates();
    return { url: store.invoices[1].renderedPages[0], number, date };
  });

  const toastFor = message => page.getByRole('status').filter({ hasText: message }).locator('..').getByRole('button', { name: '撤销', exact: true });
  await page.getByRole('button', { name: '筛选与入账' }).click();
  await page.getByRole('button', { name: '批量移除重复' }).click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.__inv.invoiceStore.invoices.map(item => item.id)), ['first', 'last']);
  await toastFor('每组保留一张').click();
  assert.deepEqual(await page.evaluate(() => window.__inv.invoiceStore.invoices.map(item => item.id)), ['first', 'copy', 'last']);
  assert.equal(await page.evaluate(() => window.__inv.invoiceStore.selectedId), 'copy');
  assert.equal(await page.evaluate(async url => (await fetch(url)).ok, initial.url), true);

  await page.evaluate(() => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    actions.removeConfirmedDuplicates({ undoable: true });
    store.selectedId = 'first';
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['发票号码','开票日期','价税合计','销售方','购买方'], [initial.number, initial.date, 100, '合成商户', '合成购买方']]), '合成清单');
  await page.locator('.invoice-upload-actions input[type=file]:not([webkitdirectory])').setInputFiles({ name: '合成.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  await page.getByRole('button', { name: '采用票面价税合计' }).click();
  const animations = input => input.getAnimations().map(animation => animation.effect.getTiming().duration);
  assert.ok((await page.getByLabel('价税合计', { exact: true }).first().evaluate(animations)).includes(600));
  await toastFor('已按票面价税合计核对').click();
  await page.getByRole('button', { name: '采用票面价税合计' }).waitFor();
  await page.getByRole('button', { name: '合成工地', exact: true }).click();
  assert.ok((await page.getByRole('combobox', { name: '使用工地' }).evaluate(animations)).includes(600));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const project = page.getByRole('combobox', { name: '使用工地' });
  await project.evaluate(input => input.getAnimations().forEach(animation => animation.cancel()));
  await page.getByRole('button', { name: '合成工地', exact: true }).click();
  assert.ok(!(await project.evaluate(animations)).includes(600));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  const stale = await page.evaluate(async url => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    actions.clearAll();
    const detached = await fetch(url).then(() => false, () => true);
    return { ids: store.invoices.map(item => item.id), detached };
  }, initial.url);
  assert.deepEqual(stale, { ids: [], detached: true });
  await toastFor('每组保留一张').waitFor({ state: 'hidden' });

  const reimport = await page.evaluate(async () => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const blob = await new Promise(resolve => canvas.toBlob(resolve));
    const file = new File([blob], '再次导入.png', { type: 'image/png' });
    const fields = { number: '26990000000000000009', date: '2026-01-10', seller: '合成商户', buyer: '合成购买方', type: '普通发票', amount: 5, total: 5 };
    const create = id => {
      const url = URL.createObjectURL(file);
      return { id, name: id, kind: 'image', blob: file, fields: { ...fields }, status: 'done', history: {}, pages: [{ dataUrl: url }], renderedPages: [url] };
    };
    const copy = create('old-copy');
    const url = copy.renderedPages[0];
    store.invoices = [create('old-first'), copy];
    actions.removeConfirmedDuplicates({ undoable: true });
    await actions.addFiles([file]);
    return { copyExists: store.invoices.some(inv => inv.id === 'old-copy'), detached: await fetch(url).then(() => false, () => true) };
  });
  assert.deepEqual(reimport, { copyExists: false, detached: true });
  await toastFor('每组保留一张').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__inv.invoiceStore.invoices.every(inv => !inv.rendering));
  await page.evaluate(() => window.__inv.invoiceActions.clearAll());

  await page.evaluate(() => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    store.ledger = { site: { key: 'site', seller: '原记录' } };
    actions.deleteLedgerEntries(['site']);
    store.ledger.site = { key: 'site', seller: '新记录' };
  });
  await toastFor('已将 1 张发票移入回收站').click();
  const result = await page.evaluate(() => {
    const { invoiceStore: store } = window.__inv;
    return { seller: store.ledger.site.seller, backups: store.ledgerTrash.filter(item => item.key === 'site').length };
  });
  assert.deepEqual(result, { seller: '新记录', backups: 1 });
  await page.evaluate(() => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    store.ledger.restorable = { key: 'restorable', seller: '可恢复商户' };
    actions.deleteLedgerEntries(['restorable']);
  });
  await toastFor('已将 1 张发票移入回收站').last().click();
  const restored = await page.evaluate(() => {
    const { invoiceStore: store } = window.__inv;
    return { seller: store.ledger.restorable?.seller, backups: store.ledgerTrash.filter(item => item.key === 'restorable').length };
  });
  assert.deepEqual(restored, { seller: '可恢复商户', backups: 0 });

  // 模拟桌面目录选择器，按实际组件入口逐个交付文件，无需向原生窗口发送输入。
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = { invoke: async command => {
      if (command === 'pick_intake_folder') return { id: 'synthetic', skipped: 0, files: [
        { name: '~$one.xlsx', path: '~$one.xlsx' }, { name: '~$two.xlsx', path: '~$two.xlsx' },
      ] };
      if (command === 'read_intake_file') return new Promise(resolve => { window.finishFixtureRead = () => resolve([]); });
      if (command === 'release_intake_folder') return;
      throw new Error(command);
    } };
  });
  await page.getByRole('button', { name: '导入文件夹' }).click();
  const folderBar = page.getByRole('progressbar', { name: '读取文件夹' });
  await folderBar.waitFor();
  assert.equal(await folderBar.getAttribute('max'), '2');
  await page.evaluate(() => window.finishFixtureRead());
  await page.waitForFunction(() => document.querySelector('progress')?.value === 1);
  await page.evaluate(() => window.finishFixtureRead());
  await folderBar.waitFor({ state: 'hidden' });
  await page.evaluate(() => { delete window.__TAURI_INTERNALS__; });

  // 让每张 OCR 分别结束，验证进度计数和准备附件阶段，不需要模型或客户数据。
  await page.evaluate(() => {
    const { invoiceStore: store, invoiceActions: actions } = window.__inv;
    store.invoices = ['step1','step2'].map(id => ({ id, name: id, fields: {}, history: {}, pages: [], renderedPages: [], status: 'idle' }));
    const original = actions.recognizeOne;
    actions.recognizeOne = async inv => {
      await new Promise(resolve => { window.finishFixturePage = resolve; });
      inv.status = 'done';
    };
    window.progressFinished = actions.recognizeAll().finally(() => { actions.recognizeOne = original; });
  });
  const bar = page.getByRole('progressbar', { name: '识别票据' });
  await bar.waitFor();
  assert.equal(await bar.evaluate(element => element.getBoundingClientRect().height), 2);
  assert.equal(await bar.getAttribute('max'), '2');
  await page.evaluate(() => window.finishFixturePage());
  await page.waitForFunction(() => document.querySelector('progress')?.value === 1);
  await page.evaluate(() => window.finishFixturePage());
  await page.evaluate(() => window.progressFinished);
  await bar.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
  console.log('已验证去重撤销与原图、清空与再导入的资源释放、台账同号保护、票面金额和工地高亮、减少动态效果、目录导入及 OCR 进度。');
} finally {
  await browser.close();
}

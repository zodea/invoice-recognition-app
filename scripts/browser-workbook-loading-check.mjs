// 检查带 manifest 的生产构建，参数是 `vite build --manifest` 使用的输出目录。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { preview } from 'vite';
import * as XLSX from 'xlsx/xlsx.mjs';

const { chromium } = await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
const outDir = path.resolve(process.argv[2] || 'dist');
const manifest = JSON.parse(await readFile(path.join(outDir, '.vite/manifest.json'), 'utf8'));
const sheetAsset = manifest['node_modules/xlsx/xlsx.mjs']?.file;
assert.ok(sheetAsset, '构建清单缺少 SheetJS 按需加载入口');

const app = await preview({
  configFile: false, logLevel: 'silent', build: { outDir },
  preview: { host: '127.0.0.1', port: 0, open: false },
});
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_TEST_EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }));
  let requests = 0;
  const errors = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/' + sheetAsset) requests++; });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + app.httpServer.address().port);
  await page.getByRole('button', { name: '＋ 导入文件', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(requests, 0, '发票首页提前加载了 SheetJS');
  const homeTab = page.getByRole('tab', { name: '发票与付款', exact: true });
  await homeTab.focus();
  await homeTab.press('ArrowRight');
  await page.getByRole('tabpanel', { name: '历史进项台账', exact: true }).waitFor();
  await page.keyboard.press('Home');
  await page.getByRole('tabpanel', { name: '发票与付款', exact: true }).waitFor();
  for (const tab of ['基础档案', '送货单整理', '分供方', '单价对比', '历史进项台账']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await page.waitForLoadState('networkidle');
    assert.equal(requests, 0, tab + ' 页签提前加载了 SheetJS');
  }
  const number = '26990000000000000001';
  const sheet = XLSX.utils.aoa_to_sheet([
    ['发票号码', '开票日期', '销售方名称', '购买方名称', '价税合计'],
    [number, '2026-01-10', '虚构销售单位', '虚构购买单位', 28.75],
  ]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '发票基础信息');
  await page.getByRole('button', { name: '导入进项 Excel', exact: true }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({
    name: 'synthetic.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }),
  });
  await page.getByText(/已导入 1 个文件，识别 1 条，新增 1 条/).waitFor();
  assert.equal(requests, 1, '实际导入时应加载一次 SheetJS');
  await page.getByRole('button', { name: '导出与管理' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: '导出历史台账' }).click(),
  ]);
  const result = XLSX.read(await readFile(await download.path()));
  const rows = XLSX.utils.sheet_to_json(result.Sheets['历史发票台账'], { header: 1 });
  const row = rows.find(values => values.includes(number));
  assert.ok(row?.includes('虚构销售单位') && row.includes(28.75), '导出的台账未保留合成发票明细');
  assert.equal(requests, 1, '导出应复用现有 SheetJS');
  assert.deepEqual(errors, []);
  console.log('生产版六页签冷启动、首次按需加载、进项工作簿导入及历史台账导出回读通过');
} finally {
  await browser?.close();
  await new Promise(resolve => app.httpServer.close(resolve));
}

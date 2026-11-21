// Synthetic drawer regression. The OCR fixture pauses at 27/235 for deterministic layout checks.
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
const { chromium } = await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
// DESKTOP_TEST_CDP connects to a separately launched release, with an explicitly named empty data folder.
if (process.env.DESKTOP_TEST_CDP) await checkDesktop();
else await checkBrowser();

async function checkDesktop() {
  const path = await import('node:path');
  const { PDFDocument } = await import('pdf-lib');
  const browser = await chromium.connectOverCDP(process.env.DESKTOP_TEST_CDP);
  try {
    const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://tauri.localhost'));
    assert.ok(page, '需要已运行的隔离桌面窗口');
    const initial = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('local_data_init', {}));
    assert.ok(process.env.DESKTOP_TEST_ROOT, '请提供本次隔离数据目录');
    assert.equal(path.resolve(initial.root).toLowerCase(), path.resolve(process.env.DESKTOP_TEST_ROOT).toLowerCase());
    assert.equal(JSON.parse(initial.snapshot.values['paymentRecords.v1'] || '[]').length, 0, '测试需空白隔离付款数据');
    const messageErrors = [];
    page.on('pageerror', err => messageErrors.push(err.message));
    await page.getByRole('button',{name:/付款清单与截图/}).click();
    const dialog = page.getByRole('dialog',{name:'付款清单与凭证截图'});
    const picker = dialog.locator('.compact-file-picker input[type=file]:not([webkitdirectory])');
    const queue = dialog.getByRole('region',{name:'凭证文件队列'});
    const preview = dialog.getByRole('region',{name:'凭证预览及识别结果'});
    const fixtureCount = 235;
    const files = [];
    for (let i = 1; i <= fixtureCount; i++) {
      const pdf = await PDFDocument.create();
      pdf.addPage([400,320]).drawText('Synthetic payment 2025-08-08 reference '+i, { x:10, y:200, size:12 });
      files.push({name:'2025-08-08-合成付款凭证第'+i+'份-174.00元.pdf', mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
    }
    const start = Date.now();
    await picker.setInputFiles(files);
    await queue.getByRole('button').first().waitFor({timeout:60000});
    assert.equal(await queue.getByRole('button').count(), fixtureCount);
    await queue.getByRole('button').first().click();
    await queue.getByRole('button').first().press('End');
    assert.equal(await queue.getByRole('button').last().getAttribute('aria-pressed'),'true');
    await preview.getByRole('img').waitFor({timeout:60000});
    await queue.getByText('235 / 235',{exact:true}).waitFor({timeout:180000});
    console.log('桌面版本地解析并预览 235 份合成文本 PDF 用时 '+(Date.now()-start)+' ms');
    await dialog.getByRole('button',{name:'清空本次预览'}).click();

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
      ['付款日期','收款名称','实付合计','记录类型'],['2026-08-12','原生测试商户',35,'现金无凭证'],
    ]),'合成付款表');
    await dialog.getByPlaceholder('如：2026年第三季度').fill('桌面测试期间');
    await picker.setInputFiles({name:'原生合成清单.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
    await dialog.getByRole('button',{name:'保存 1 笔',exact:true}).click();
    await dialog.getByRole('heading',{name:'付款核对',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'关闭付款工作台'}).click();
    await page.getByRole('button',{name:/付款清单与截图/}).click();
    await dialog.getByRole('heading',{name:'付款核对',exact:true}).waitFor();
    await dialog.getByRole('button',{name:'关闭付款工作台'}).click();
    await page.waitForFunction(async () => {
      const state = await window.__TAURI_INTERNALS__.invoke('local_data_init', {});
      const rows = JSON.parse(state.snapshot.values['paymentRecords.v1'] || '[]');
      return rows.length === 1 && rows[0].seller === '原生测试商户' && rows[0].total === 35 && rows[0].reimbursementPeriod === '桌面测试期间';
    }, null, {timeout:30000});
    assert.deepEqual(messageErrors,[]);
    console.log('Tauri 付款抽屉通过真实文件读取、预览、完整队列、键盘、报销期间和持久化回归');
  } finally { await browser.close(); }
}

async function checkBrowser() {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_TEST_EXECUTABLE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.route('**/src/lib/payment-evidence-import.js*', route => route.fulfill({
      contentType: 'text/javascript',
      body: `export async function recognizePaymentEvidenceFile(file, { onProgress }) {
        const index = ++window.drawerRecognized;
        onProgress('读取虚构凭证');
        if (index === 28 || index === 236) await new Promise(resolve => { window.finishDrawerBatch = resolve; });
        const fields = { seller: '测试商户' + index, total: 174, date: '2025-08-08', transactionId: String(index).padStart(32,'0') };
        return { file, fields, pages: [{ text: file.name }], transactions: [], warnings: [] };
      }`,
    }));
    await page.goto(process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5173');
    await page.getByRole('button', { name: /付款清单与截图/ }).click();
    const dialog = page.getByRole('dialog', { name: '付款清单与凭证截图' });
    await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('.payment-drawer'));
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', { name:'关闭付款工作台' }).evaluate(el => el === document.activeElement),true);
    await dialog.getByPlaceholder('如：2026年第三季度').fill('测试期间');
    await dialog.getByRole('button', { name:'批量导入归属' }).click();
    await page.getByRole('dialog',{name:'按清单批量分配工地'}).getByRole('button',{name:'关闭',exact:true}).click();

    // Exercise the drawer's HTML drop target, real file hashing, image preview and batch model.
    await dialog.evaluate(async element => {
      window.drawerRecognized = 0;
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0,0,480,360);
      ctx.fillStyle = '#34455a'; ctx.font = '24px sans-serif';
      ctx.fillText('合成付款凭证',32,68);
      ctx.font = '18px sans-serif';
      ctx.fillText('付款金额    ¥174.00',32,132);
      ctx.fillText('交易日期    2025-08-08',32,176);
      ctx.fillText('用途          抽屉回归测试',32,220);
      const png = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      const transfer = new DataTransfer();
      for (let i = 0; i < 235; i++) {
        const file = new File([png, String(i)], '2025-08-08-测试公司长名称付款凭证-' + i + '-174.00元.png', { type:'image/png' });
        transfer.items.add(file);
      }
      const target = element.querySelector('.drawer-heading');
      target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      await Promise.resolve();
      if (!element.querySelector('.drawer-drop-notice')) throw Error('整个抽屉拖入提示未显示');
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    });
    await page.waitForFunction(() => window.finishDrawerBatch);
    const queue = dialog.getByRole('region', { name:'凭证文件队列' });
    const preview = dialog.getByRole('region', { name:'凭证预览及识别结果' });
    assert.equal(await queue.getByRole('progressbar').getAttribute('value'), '27');
    assert.equal(await queue.getByRole('button').count(),235);
    const row = queue.getByRole('button').first();
    const started = await page.evaluate(() => performance.now());
    await row.click();
    await row.press('End');
    assert.equal(await queue.getByRole('button').last().getAttribute('aria-pressed'), 'true');
    await queue.getByRole('button').last().press('Home');
    await row.press('ArrowDown');
    assert.equal(await queue.getByRole('button').nth(1).getAttribute('aria-pressed'), 'true');
    await queue.getByRole('button').nth(1).press('ArrowUp');
    assert.equal(await queue.locator('button[tabindex="0"]').count(),1);
    await preview.getByText('测试商户1',{exact:true}).waitFor();
    const elapsed = await page.evaluate(() => performance.now()) - started;
    const frameGaps = await queue.locator('.queue-list').evaluate(async list => {
      const frame = () => new Promise(requestAnimationFrame);
      const samples = [];
      const scrollRange = list.scrollHeight - list.clientHeight;
      let last = await frame();
      for (let step = 1; step <= 32; step++) {
        list.scrollTop = scrollRange * step / 32;
        const now = await frame();
        samples.push(now - last);
        last = now;
      }
      list.scrollTop = 0;
      samples.sort((a,b) => a-b);
      return { median: samples[15].toFixed(1), p95:samples[30].toFixed(1) };
    });
    console.log('235 行队列滚动 32 帧间隔中位数 '+frameGaps.median+' ms，P95 '+frameGaps.p95+' ms');
    console.log('235 行队列点击、End、Home、下移、上移及显示摘要共 ' + Math.round(elapsed) + ' ms（含浏览器驱动等待）');
    assert.equal(await preview.getByRole('img').evaluate(el => el.complete && el.naturalWidth > 0), true);
    for (const width of [1280,1920,900,414]) {
      await page.setViewportSize({width,height:800});
      const [box,listBox,previewBox,toolbar,chip,firstRow] = await Promise.all([
        dialog.boundingBox(),queue.boundingBox(),preview.boundingBox(),dialog.locator('.import-toolbar').boundingBox(),
        dialog.getByText('本次保存 0',{exact:true}).boundingBox(),row.boundingBox(),
      ]);
      assert.ok(toolbar.width > box.width * .90 && chip.y < box.y + 190, width+' 工具和状态在顶部');
      assert.ok(listBox.width >= 320 && firstRow.height < 85, width+' 队列文件名和状态可读');
      if (width >= 1280) {
        assert.ok(previewBox.x >= listBox.x + listBox.width && previewBox.width > 340, width+' 队列与预览并排');
        assert.equal(Math.round((await dialog.locator('.payment-records-sidebar').boundingBox()).width),340);
      } else {
        assert.ok(previewBox.y >= listBox.y + listBox.height, width+' 窄工作区单列显示');
      }
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), width+' 抽屉无横向溢出');
    }

    await page.setViewportSize({width:1280,height:800});
    await page.evaluate(() => window.finishDrawerBatch());
    await queue.getByText('235 / 235',{exact:true}).waitFor();
    // Add a saved record and a real persisted attachment to check the gallery and the editable record path.
    await page.evaluate(async () => {
      const { savePayments } = await import('/src/lib/payment-store.js');
      const { linkPaymentFile } = await import('/src/lib/payment-attachments.js');
      const row = { id: 'payment-drawer-synthetic', date:'2025-08-08', seller:'测试商户', total:174, reimbursement:'未核对' };
      const canvas = document.createElement('canvas');
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      const file = new File([blob],'合成凭证174元.png',{type:'image/png'});
      const metadata = await linkPaymentFile(row,{file,fields:{seller:'测试商户',total:174}},'付款凭证');
      savePayments([{ ...row,...metadata }]);
    });
    await dialog.getByRole('heading',{name:'付款核对',exact:true}).waitFor();
    await dialog.getByLabel('凭证截图画廊').getByRole('button',{name:/合成凭证/}).waitFor();
    // A new import temporarily takes the right-hand workspace, then returns to the current record.
    await page.evaluate(() => { delete window.finishDrawerBatch; });
    await dialog.locator('.compact-file-picker input[type=file]:not([webkitdirectory])').setInputFiles({
      name:'追加合成凭证.png',mimeType:'image/png',
      buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5LaWsAAAAASUVORK5CYII=','base64'),
    });
    await page.waitForFunction(() => window.finishDrawerBatch);
    await queue.waitFor();
    assert.equal(await queue.getByRole('progressbar').getAttribute('value'),'235');
    assert.equal(await queue.getByRole('progressbar').getAttribute('max'),'236');
    await page.evaluate(() => window.finishDrawerBatch());
    await dialog.getByRole('heading',{name:'付款核对',exact:true}).waitFor();
    const toggle = dialog.getByRole('button',{name:/展开本次导入核对/});
    await toggle.click();
    await queue.waitFor();
    await dialog.getByRole('button',{name:/返回付款记录/}).click();
    await dialog.getByRole('button',{name:'保存核对结果'}).click();
    const readStored = () => page.evaluate(async () => (await import('/src/lib/payment-store.js')).paymentStore.rows);
    assert.equal((await readStored())[0].total,174);
    assert.equal((await readStored()).length,1);
    await dialog.getByRole('button',{name:'清空本次预览'}).click();
    assert.equal((await readStored()).length,1);

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ['付款日期','收款名称','实付合计','记录类型'],
      ['2026-08-12','新导入测试商户',35,'现金无凭证'],
    ]), '合成付款表');
    await dialog.locator('.compact-file-picker input[type=file]:not([webkitdirectory])').setInputFiles({
      name:'测试付款清单.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'}),
    });
    await toggle.click();
    await dialog.getByRole('button',{name:'保存 1 笔',exact:true}).click();
    await dialog.getByText('本次保存 0',{exact:true}).waitFor();
    const newRecord = (await readStored()).find(row => row.seller === '新导入测试商户');
    assert.equal(newRecord.total,35);
    assert.equal(newRecord.reimbursementPeriod,'测试期间');
    await dialog.getByRole('button',{name:'关闭付款工作台'}).click();
    await dialog.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);
    console.log('付款抽屉通过 235 份合成凭证、四种窗口、焦点、拖入、进度、OCR 摘要、记录切换及保存回归');
  } finally { await browser.close(); }
}

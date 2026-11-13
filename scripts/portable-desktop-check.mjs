// Optional native integration test. Run only against an isolated desktop profile.
// Seed an old release, close it, then open the new release in a fresh directory
// using the same WEBVIEW2_USER_DATA_FOLDER and --edge-webview-switches CDP port.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
const { chromium } = await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
const browser = await chromium.connectOverCDP(process.env.DESKTOP_TEST_CDP || 'http://127.0.0.1:9239');
const page = browser.contexts()[0].pages().find(p => p.url().startsWith('http://tauri.localhost'));
assert.ok(page, '需要已运行的隔离桌面测试窗口');
const evidence = process.env.DESKTOP_TEST_EVIDENCE;
assert.ok(evidence, '指定隔离目录中的预期数据文件');
try {
  if (process.argv.includes('--seed')) {
    const pdf = await PDFDocument.create(); pdf.addPage([400, 300]);
    const fixture = await page.evaluate(async bytes => {
      if (localStorage.length) throw new Error('只允许向完全空白的隔离测试档案写入虚构数据');
      const prior = await new Promise((resolve, reject) => { const r = indexedDB.open('invoice-ledger-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('attachments', { keyPath: 'key' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const priorCount = await new Promise((resolve, reject) => { const r = prior.transaction('attachments').objectStore('attachments').count(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); prior.close();
      if (priorCount) throw new Error('隔离测试档案已经有原件，禁止写入虚构数据');
      const values = {
        'invoiceLedger.v1': JSON.stringify({ '0001': { number: '0001', buyer: '测试购买方', seller: '测试销售方', date: '2026-11-01', total: 106, amount: 100, tax: 6, reimbursement: '已报销', projectAllocations: [{ project: '工地甲', amount: 53 }], supplementHashes: ['linked-hash'] } }),
        'paymentRecords.v1': JSON.stringify([{ id: 'p1', date: '2026-11-01', seller: '测试收款人', total: 25, evidenceHash: 'payment-hash', evidenceConfirmed: true, reimbursement: '未核对' }]),
        'expenseDirectory.v1': JSON.stringify({ buyers: ['测试购买方'], projects: ['工地甲'], people: ['测试人'], rules: [], deletedArchives: [{ kind: 'projects', value: '已删工地' }] }),
        'supplierDb.v1': JSON.stringify([{ id: 's1', name: '测试分供方', bankAccount: '0012345678', attachments: [{ id: 'a1', key: 'supplier:s1:a1', name: '供应商附件.pdf' }] }]),
        'invoiceLedgerTrash.v1': JSON.stringify([{ id: 'trash1', key: 'deleted', entry: { number: 'deleted', total: -12.5 } }]),
        'invoiceSupplements.v1': JSON.stringify([{ hash: 'pending-hash', name: '待匹配.pdf', fields: { docType: '行程单' }, ledgerKey: '' }]),
        'invoiceLedgerTrashCleanup.v1': '[]',
        'appSettings.v1': JSON.stringify({ vlToken: 'synthetic-token', hoverZoom: true }),
        'deliveryPartitions.v1': '[]', 'priceCompareManualGroups': '{"test":"group"}',
        invoiceFilenameTemplate: '{销售方}-{日期}', invoiceExportSort: 'date',
      };
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      const file = name => new File([new Uint8Array(bytes)], name, { type: 'application/pdf', lastModified: 12345 });
      const records = ['0001', 'payment:p1', 'supplier:s1:a1', 'supplement:pending-hash', 'deleted'].map(key => ({ key, name: key + '.pdf', blob: file(key + '.pdf'), custom: { preserve: true } }));
      records[0].supplements = [{ hash: 'linked-hash', type: '行程单', name: '随票附件.pdf', blob: file('随票附件.pdf') }];
      records.push({ key: 'supplement-only', supplements: [{ hash: 'empty-file', blob: new File([], '零字节测试.txt', { type: 'text/plain' }) }] });
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('invoice-ledger-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('attachments', { keyPath: 'key' }); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise((resolve, reject) => { const tx = db.transaction('attachments', 'readwrite'); for (const record of records) tx.objectStore('attachments').put(record); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); db.close();
      const encode = async blob => { const a = new Uint8Array(await blob.arrayBuffer()); let str = ''; for (const byte of a) str += String.fromCharCode(byte); return { name: blob.name, type: blob.type, lastModified: blob.lastModified, dataBase64: btoa(str) }; };
      const encoded = [];
      for (const record of records) { const r = { ...record }; if (r.blob) r.blob = await encode(r.blob); if (r.supplements) r.supplements = await Promise.all(r.supplements.map(async item => ({ ...item, blob: await encode(item.blob) }))); encoded.push(r); }
      return { values, records: encoded };
    }, [...await pdf.save()]);
    await fs.writeFile(evidence, JSON.stringify(fixture));
    console.log('SYNTHETIC SEED: 12 settings, 6 original groups, 7 binary files');
  } else {
    await page.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 60000 });
    const actual = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('local_data_init', {}));
    const expected = JSON.parse(await fs.readFile(evidence, 'utf8'));
    assert.deepEqual(actual.snapshot.values, expected.values, '全部设置和业务数据必须逐字保留');
    assert.equal(Object.keys(actual.snapshot.attachments).length, expected.records.length);
    for (const record of expected.records) {
      const result = await page.evaluate(key => window.__TAURI_INTERNALS__.invoke('local_data_get_attachment', { key }), record.key);
      assert.deepEqual(result, record, '元数据及每份原件的字节必须完全一致');
    }
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: '一键完整备份', exact: true }).waitFor();
    assert.ok((await page.locator('.local-data-path').first().textContent()).includes('数据'));
    if (process.env.DESKTOP_TEST_SCREENSHOT) await page.screenshot({ path: process.env.DESKTOP_TEST_SCREENSHOT });
    console.log(JSON.stringify({ nativeMigration: 'passed', copiedFolder: actual.root, values: Object.keys(expected.values).length, records: expected.records.length, files: actual.summary.files,
      dataDigest: createHash('sha256').update(JSON.stringify(actual.snapshot.values)).digest('hex') }));
  }
} finally { await browser.close(); }

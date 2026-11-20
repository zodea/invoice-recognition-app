import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import { toChineseUpper } from '../src/lib/chinese-money.js';
import { intakeFile, isSystemFile } from '../src/lib/fileIntake.js';
import { parseInvoice } from '../src/lib/invoice-parse.js';
import { buildCheckedInvoiceWorkbook, readInvoiceSourceWorkbook } from '../src/lib/invoiceExcelImport.js';
import { matchInvoiceFiles, sameInvoiceNumber } from '../src/lib/invoiceFileMatcher.js';
import { coveredTruncatedTransactions } from '../src/lib/payment-transactions.js';
import { paymentEvidenceCandidates } from '../src/lib/payment-reconciliation.js';

assert.equal(toChineseUpper('0'), '零元整');
assert.equal(toChineseUpper('-10,001.08'), '负壹万零壹元零捌分');
assert.equal(toChineseUpper('12.345'), '');
assert.equal(intakeFile({ name: '测试.pdf' }, '/季度\\行程单\\测试.pdf').parentFolder, '季度/行程单');
assert.equal(isSystemFile('~$测试.xlsx'), true);
const number = '26123456789012345678';
const date = '2026-11-02';
const parsed = parseInvoice(`电子发票（普通发票）\n发票号码：\n${[...number].join('\n')}\n开票日期：2026年11月2号`);
assert.equal(parsed.number, number);
assert.equal(parsed.date, date);

const sourcePath = '季度/清单/测试清单.xlsx';
const worksheet = XLSX.utils.aoa_to_sheet([
  ['发票号码', '开票日期', '价税合计', '销售方', '购买方', '实际付款金额'],
  [number, date, 100, '测试销售方', '测试购买方', 90],
  ['', '', '', '', '', 15],
  ['', date, 5, '测试销售方', '', ''],
  ['合计', '', 100, '', '', 105],
]);
worksheet['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
worksheet.C4.f = 'C2-C5';
worksheet.F5.f = 'SUM(F2:F3)';
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, '九月');
const source = readInvoiceSourceWorkbook(XLSX.write(workbook, { type: 'array' }), sourcePath);
assert.equal(source.records.length, 1);
assert.deepEqual(source.records[0].paymentSplits, [{ rowIndex: 1, amount: 90 }, { rowIndex: 2, amount: 15 }]);

const original = { id: 'main', status: 'done', sourcePath: '季度/发票/测试.pdf', sha256Short: '42957abc', fields: { number, date, total: 106, amount: 100, seller: '测试销售方', buyer: '测试购买方' } };
const unmatched = { ...original, id: 'outside', fields: { ...original.fields, number: '26123456789012345679' } };
const supplement = { id: 'trip', status: 'done', name: '测试行程.pdf', sourcePath: '季度/行程单/测试行程.pdf', fields: { relatedInvoiceNumber: number, attachmentType: '行程单' } };
const matches = matchInvoiceFiles(source.records, [original, unmatched, supplement]);
assert.equal(matches.byInvoice.get(original.id).netDifference, true);
assert.equal(matches.byInvoice.get(unmatched.id).label, '未入表原件');
assert.equal(matches.supplementCounts.get(original.id), 1);
assert.equal(sameInvoiceNumber({ number: 12345678 }, { fields: { number: '0012345678', docType: '医疗票据' } }), true);
const fuzzy = { ...source.records[0], number: '', total: 105 };
assert.equal(matchInvoiceFiles([fuzzy], [original]).byRow.get(fuzzy.id).rule, 'L2');
assert.equal(matchInvoiceFiles([fuzzy], [original, unmatched]).byRow.size, 0);
const exported = XLSX.read(buildCheckedInvoiceWorkbook(source, matches.byRow), { cellFormula: true }).Sheets['九月'];
assert.equal(exported.F5.f, 'SUM(F2:F3)');
assert.deepEqual(exported['!merges'], worksheet['!merges']);
assert.equal(decodeURIComponent(exported.G2.l.Target), './../发票/测试.pdf');
assert.equal(exported.G2.f, 'HYPERLINK("./../发票/测试.pdf","打开原件")');
assert.equal(decodeURIComponent(exported.H2.l.Target), './../行程单/测试行程.pdf');
assert.equal(exported.I2.v, 'sha256:42957abc|matched:L1');

const payment = { fields: { date, total: 111, seller: '泊云速停车', kind: 'payment' } };
const candidates = paymentEvidenceCandidates({ date, total: 105, seller: '速停车' }, [payment]);
assert.equal(candidates[0].score, 0);
assert.match(candidates[0].hint, /\+6\.00/);
const truncated = { complete: false, date, total: 105, sourceGroup: '阶段一' };
const complete = { ...truncated, complete: true, transactionId: 'test-100' };
assert.deepEqual([...coveredTruncatedTransactions([truncated], [complete])], [0]);
assert.equal(coveredTruncatedTransactions([truncated], [complete, { ...complete, transactionId: 'test-101' }]).size, 0);
assert.equal(coveredTruncatedTransactions([truncated], [{ ...complete, sourceGroup: '阶段二' }]).size, 0);
console.log('工作台：票号与日期、合并与差额公式、四级配对、保留原工作簿、相对链接及阶段候选验证通过');

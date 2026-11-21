import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import { toChineseUpper } from '../src/lib/chinese-money.js';
import { intakeFile, isSystemFile } from '../src/lib/fileIntake.js';
import { parseInvoice } from '../src/lib/invoice-parse.js';
import { applyInvoiceFilenameFallback, parseInvoiceFilename } from '../src/lib/invoice-filename.js';
import { recoverMedicalReceiptNumber, shouldRetryMedicalNumber } from '../src/lib/invoice-medical-ocr.js';
import { buildCheckedInvoiceWorkbook, invoiceWorkbooksWithoutExportCopies, readInvoiceSourceWorkbook } from '../src/lib/invoiceExcelImport.js';
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

const medicalName = '2026-11-02-示例医疗机构-1234.56元-医疗票据.pdf';
assert.deepEqual(parseInvoiceFilename(medicalName), { date, seller: '示例医疗机构', total: '1234.56', number: '', type: '医疗票据', source: 'filename', hasSellerTruth: true });
const medicalFields = { docType: '未识别', date: '2026-11-01', total: 1234.57 };
applyInvoiceFilenameFallback(medicalFields, medicalName);
assert.deepEqual(medicalFields, { date: '2026-11-01', total: 1234.57, dateText: '2026-11-01', seller: '示例医疗机构', type: '医疗票据', docType: '医疗票据' });
const ordinaryFields = { docType: '增值税发票', type: '普通发票' };
applyInvoiceFilenameFallback(ordinaryFields, medicalName);
assert.equal(ordinaryFields.docType, '增值税发票');
assert.equal(ordinaryFields.type, '普通发票');
assert.equal(shouldRetryMedicalNumber({ docType: '未识别' }, medicalName), true);
assert.equal(shouldRetryMedicalNumber({ docType: '医疗票据' }, '扫描件.pdf'), true);
assert.equal(shouldRetryMedicalNumber({ ...medicalFields, number: '0012345678' }, medicalName), false);
assert.equal(shouldRetryMedicalNumber(ordinaryFields, medicalName), false);
assert.equal(shouldRetryMedicalNumber({}, '扫描件.pdf'), false);
const medicalPage = { dataUrl: 'blob:medical-fixture', pageIndex: 0 };
const numberRegion = { x: 0.6, y: 0.34, width: 0.1, height: 0.01, page: 0, text: '0012345678' };
const crops = [];
const medicalNumber = await recoverMedicalReceiptNumber(medicalPage, (page, crop, onRegions) => {
  assert.equal(page, medicalPage);
  crops.push(crop);
  if (crops.length === 1) return ['医保编号：0012345699', '业务流水号：0012345688', '票据号码：00123'];
  onRegions([numberRegion]);
  return ['景据号码：００ １２３４５６７８'];
});
assert.equal(crops.length, 2);
assert.equal(medicalNumber.number, '0012345678');
assert.deepEqual(medicalNumber.regions, [numberRegion]);
assert.equal(await recoverMedicalReceiptNumber(medicalPage, () => ['票据号码：0012345678', '票据号码：0012345699']), null);
assert.equal(await recoverMedicalReceiptNumber(medicalPage, () => ['0012345678', '票据号码：00123456789012345']), null);
assert.equal(await recoverMedicalReceiptNumber(medicalPage, () => { throw Error('区域识别失败'); }), null);
const medicalRow = { id: 'medical-row', number: medicalNumber.number, date: medicalFields.date, seller: medicalFields.seller, total: medicalFields.total };
const medicalScan = { id: 'medical-scan', status: 'done', name: medicalName, fields: { ...medicalFields, number: medicalNumber.number } };
assert.equal(matchInvoiceFiles([medicalRow], [medicalScan]).byRow.get(medicalRow.id).rule, 'L1');

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
const checked = buildCheckedInvoiceWorkbook(source, matches.byRow);
const exported = XLSX.read(checked, { cellFormula: true }).Sheets['九月'];
assert.equal(exported.F5.f, 'SUM(F2:F3)');
assert.deepEqual(exported['!merges'], worksheet['!merges']);
const checkedXml = new TextDecoder().decode(XLSX.read(checked, { bookFiles: true }).files['xl/worksheets/_rels/sheet1.xml.rels'].content);
assert.ok(checkedXml.includes('Target="../发票/测试.pdf"'));
assert.equal(exported.G2.f, 'HYPERLINK("./../发票/测试.pdf","打开原件")');
assert.ok(checkedXml.includes('Target="../行程单/测试行程.pdf"'));
assert.equal(exported.I2.v, 'sha256:42957abc|matched:L1');
const reopened = readInvoiceSourceWorkbook(checked, sourcePath);
assert.deepEqual(reopened.records[0].prior, { hash: '42957abc', rule: 'L1', path: './../发票/测试.pdf' });
const exportedCopy = readInvoiceSourceWorkbook(checked, sourcePath.replace(/\.xlsx$/, '_核对版.xlsx'));
assert.deepEqual(invoiceWorkbooksWithoutExportCopies([source, exportedCopy]), [exportedCopy]);
assert.equal(invoiceWorkbooksWithoutExportCopies([{ ...source, records: [{ ...source.records[0], total: 123 }] }, exportedCopy]).length, 2);
const otherCopy = { ...original, id: 'copy', sha256Short: 'ab123456', sourcePath: '季度/旧票/测试.pdf' };
assert.equal(matchInvoiceFiles(reopened.records, [original, otherCopy]).byRow.get(reopened.records[0].id).invoice.id, original.id);
assert.equal(matchInvoiceFiles(reopened.records, [original, { ...otherCopy, sha256Short: original.sha256Short }]).byRow.size, 0);
const rebuilt = XLSX.read(buildCheckedInvoiceWorkbook(reopened, new Map())).Sheets['九月'];
assert.equal(rebuilt['!ref'], exported['!ref']);
assert.equal(rebuilt.G2, undefined);

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

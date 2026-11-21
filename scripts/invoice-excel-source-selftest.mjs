import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import { buildCheckedInvoiceWorkbook, readInvoiceSourceWorkbook } from '../src/lib/invoiceExcelImport.js';

const display = 'yyyy-mm-dd hh:mm:ss.000';
const iso = '2026-11-02T13:24:56.789Z';
const sourceDay = (Date.UTC(2026, 10, 2) - Date.UTC(1899, 11, 30)) / 86400000;
const dateTime = sourceDay + (13 * 3600000 + 24 * 60000 + 56789) / 86400000;
const nextDateTime = sourceDay + 1 + (3 * 3600000 + 15 * 60000 + 32125) / 86400000;
const numeric = sourceDay + 0.8123456789;
const relativeTarget = '../发票/季度 & 医疗%23%25.png';
const absoluteTarget = 'file:///C:/凭证/原件.png';
const webTarget = 'https://example.invalid/费用?one=1&two=2#详情';
const source = XLSX.utils.book_new();
const sheet = XLSX.utils.aoa_to_sheet([
  ['发票号码', '开票日期', '销售方', '价税合计', '凭证', '付款时间'],
  ['26123456789012345678', new Date(2026, 10, 2, 13, 24, 56, 789), '测试机构', 100, '原附件', numeric],
  ['26123456789012345679', new Date(2026, 10, 3, 3, 15, 32, 125), '测试机构', 200, '绝对路径'],
  ['26123456789012345680', '2026-11-04', '测试机构', 300, '网页'],
], { cellDates: true });
sheet.B2.z = display;
sheet.B3.z = display;
sheet.F2.z = display;
sheet.E2.l = { Target: relativeTarget };
sheet.E3.l = { Target: absoluteTarget };
sheet.E4.l = { Target: webTarget };
const auditOnly = XLSX.utils.aoa_to_sheet([['附件清单'], ['单独的原附件'], ['当前表内跳转']]);
auditOnly.A2.l = { Target: relativeTarget };
auditOnly.A3.l = { Target: "#'核对'!B2" };
XLSX.utils.book_append_sheet(source, sheet, '核对');
XLSX.utils.book_append_sheet(source, auditOnly, '附页');

const options = { type: 'array', bookType: 'xlsx', cellDates: true };
const raw = XLSX.write(source, options);
const xml = (book, path) => new TextDecoder().decode(book.files?.[path]?.content);
const sourceBook = XLSX.read(raw, { bookFiles: true });
const entry = 'xl/worksheets/sheet1.xml';
const sheetXml = xml(sourceBook, entry);
assert.ok(sheetXml.includes(iso), 'fixture must contain the specified non-midnight ISO timestamp');
const zip = XLSX.CFB.read(new Uint8Array(raw), { type: 'array' });
const prefixed = sheetXml.replace(/<worksheet /, '<worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ')
  .replace(/<c(\b[^>]*\br="B2"[^>]*\bt="d"[^>]*)><v>([^<]+)<\/v><\/c>/, '<x:c$1><x:v>$2</x:v></x:c>');
assert.ok(prefixed.includes('<x:c r="B2"'));
XLSX.CFB.utils.cfb_add(zip, entry, new TextEncoder().encode(prefixed));
const value = XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' });
const imported = readInvoiceSourceWorkbook(value, '季度/清单/核对.xlsx');
assert.equal(imported.records[0]?.date, '2026-11-02');
const exported = XLSX.read(buildCheckedInvoiceWorkbook(imported, new Map()), { bookFiles: true, cellNF: true });
const exportedSheet = exported.Sheets.核对;
const rels = name => xml(exported, 'xl/worksheets/_rels/' + name + '.xml.rels');
assert.ok(rels('sheet1').includes('Target="../发票/季度 &amp; 医疗%23%25.png"'), 'Chinese native relationship round-trips with one layer of XML escaping');
assert.ok(rels('sheet1').includes('Target="file:///C:/凭证/原件.png"'));
assert.ok(rels('sheet1').includes('Target="https://example.invalid/费用?one=1&amp;two=2"'));
assert.equal(exportedSheet.E4.l.Target.split('#').at(-1), '详情');
assert.ok(rels('sheet2').includes('Target="../发票/季度 &amp; 医疗%23%25.png"'), 'sheets with no invoice rows still preserve links');
assert.equal(exported.Sheets.附页.A3.l.Target, "#'核对'!B2");
assert.ok(Math.abs(exportedSheet.B2.v - dateTime) < 0.000000001, 'raw OOXML wall-clock time preserves hours, minutes, seconds and milliseconds');
assert.equal(exportedSheet.B2.z, display);
assert.ok(Math.abs(exportedSheet.B3.v - nextDateTime) < 0.000000001, 'unprefixed OOXML date cells stay valid numeric dates');
assert.equal(exportedSheet.F2.v, numeric);
assert.equal(exportedSheet.F2.z, display);

source.Workbook = { WBProps: { date1904: true } };
const source1904 = readInvoiceSourceWorkbook(XLSX.write(source, options), '季度/清单/1904.xlsx');
assert.equal(source1904.records[0]?.date, '2026-11-02');
const checked1904 = XLSX.read(buildCheckedInvoiceWorkbook(source1904, new Map()), { cellNF: true });
assert.equal(checked1904.Workbook.WBProps.date1904, true);
assert.ok(Math.abs(checked1904.Sheets.核对.B2.v - (dateTime - 1462)) < 0.000000001);
console.log('核对版保留原附件关系、日期格式及日内时间');

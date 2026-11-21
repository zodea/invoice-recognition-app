import * as XLSX from 'xlsx/xlsx.mjs';
import { readPaymentExcel, paymentDate } from './payment-records.js';
import { moneyCents } from './invoice-allocation.js';

import { relativeLink } from './invoice-workbook-links.js';
export { invoiceWorkbooksWithoutExportCopies, relativeLink } from './invoice-workbook-links.js';

const aliases = {
  number: ['数电发票号码', '发票号码', '发票号', '发票编号', '票据号码', '票号'],
  date: ['开票日期', '发票日期', '票据日期', '日期'],
  total: ['价税合计', '含税金额', '发票金额', '开票金额', '合价', '金额(元)', '金额'],
  seller: ['销售方', '销售方名称', '销方名称', '开票单位', '公司名称', '厂商名称', '商家'],
  buyer: ['购买方', '购买方名称', '购买方抬头', '抬头'],
  payment: ['实际付款金额', '支付金额', '付款金额', '实付金额', '报销金额'],
};
const normalize = value => String(value ?? '').trim().normalize('NFKC').replace(/\s/g, '');
const summary = /^(?:本[页期月季年次])?(?:总数|总计|合计|小计|全部合计|合价)[：:]?$/;
const checkedHeaders = ['原件链接', '附件/凭证链接', '关联指纹'];

function checkedColumns(headers) {
  const first = headers.indexOf(checkedHeaders[0]);
  return first >= 0 && checkedHeaders.every((name, index) => headers[first + index] === name) ? first : -1;
}

export function readInvoiceSourceWorkbook(bytes, sourcePath) {
  const workbook = readPaymentExcel(bytes);
  const date1904 = !!workbook.Workbook?.WBProps?.date1904;
  const records = [];
  let hasCheckedColumns = false;
  for (const sheet of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheet];
    if (!worksheet['!ref']) continue;
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: { s: { r: range.s.r, c: 0 }, e: range.e }, defval: '' });
    const head = data.findIndex(row => row.map(normalize).some(value => aliases.number.includes(value)));
    if (head < 0) continue;
    const headers = data[head].map(normalize);
    const checked = checkedColumns(headers);
    if (checked >= 0) hasCheckedColumns = true;
    const columns = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, names.map(name => headers.indexOf(name)).find(index => index >= 0)]));
    const merges = (worksheet['!merges'] || []).filter(merge => merge.s.c === columns.number && merge.e.c === columns.number && merge.s.r !== merge.e.r);
    for (let index = head + 1; index < data.length; index++) {
      const row = data[index], rowIndex = range.s.r + index;
      const formula = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columns.total ?? range.e.c })]?.f;
      if (row.some(value => summary.test(normalize(value))) || (!row[columns.number] && /^\$?[A-Z]+\$?\d+\s*-\s*\$?[A-Z]+\$?\d+$/i.test(formula || ''))) continue;
      const merged = merges.find(merge => rowIndex >= merge.s.r && rowIndex <= merge.e.r);
      if (merged && merged.s.r !== rowIndex) continue;
      const number = normalize(row[columns.number]);
      const date = paymentDate(row[columns.date], date1904), seller = normalize(row[columns.seller]);
      if (!number && (!date || !seller)) continue;
      const total = row[columns.total] ?? '';
      const paymentSplits = merged && columns.payment != null ? Array.from({ length: merged.e.r - rowIndex + 1 }, (_, offset) => ({ rowIndex: rowIndex + offset, amount: data[index + offset]?.[columns.payment] })).filter(split => moneyCents(split.amount) !== null) : [];
      const fingerprint = checked >= 0 && normalize(row[checked + 2]).match(/^sha256:([\da-f]{8})\|matched:(L[12])$/);
      const formulaLink = checked >= 0 && worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: checked })]?.f?.match(/^HYPERLINK\("((?:[^"]|"")*)",/i);
      const prior = fingerprint && formulaLink && { hash: fingerprint[1], rule: fingerprint[2], path: formulaLink[1].replaceAll('""', '"') };
      records.push({ id: JSON.stringify([sourcePath, sheet, rowIndex]), sourcePath, sheet, rowIndex, headerIndex: range.s.r + head, number, numberUnsafe: typeof row[columns.number] === 'number' && number.length > 15, date, total, seller, buyer: normalize(row[columns.buyer]), paymentSplits, prior });
    }
  }
  return { workbook, records, sourcePath, hasCheckedColumns };
}

function linkCell(path, title) {
  return { t: 's', v: title, f: `HYPERLINK("${path.replaceAll('"', '""')}","${title}")`, l: { Target: path.slice(2).replaceAll('%', '%25').replaceAll('#', '%23') } };
}

export function buildCheckedInvoiceWorkbook(source, matches) {
  const copy = { ...source.workbook, Sheets: { ...source.workbook.Sheets } };
  for (const sheet of new Set(source.records.map(row => row.sheet))) {
    const records = source.records.filter(row => row.sheet === sheet);
    const worksheet = { ...copy.Sheets[sheet] };
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    const headers = Array.from({ length: range.e.c + 1 }, (_, col) => normalize(worksheet[XLSX.utils.encode_cell({ r: records[0].headerIndex, c: col })]?.v));
    const checked = checkedColumns(headers);
    const first = checked >= 0 ? checked : range.e.c + 1;
    const put = (row, col, cell) => { worksheet[XLSX.utils.encode_cell({ r: row, c: col })] = cell; };
    checkedHeaders.forEach((header, index) => put(records[0].headerIndex, first + index, { t: 's', v: header }));
    for (const row of records) {
      for (let index = 0; index < checkedHeaders.length; index++) delete worksheet[XLSX.utils.encode_cell({ r: row.rowIndex, c: first + index })];
      const match = matches.get(row.id);
      if (!match?.invoice) continue;
      const { invoice, supplements, rule } = match;
      const original = relativeLink(source.sourcePath, invoice.sourcePath || invoice.name);
      const attachment = supplements?.[0];
      const extra = attachment && relativeLink(source.sourcePath, attachment.sourcePath || attachment.name);
      if (!original) continue;
      put(row.rowIndex, first, linkCell(original, '打开原件'));
      if (extra) put(row.rowIndex, first + 1, linkCell(extra, '查看附件'));
      if (invoice.sha256Short) put(row.rowIndex, first + 2, { t: 's', v: `sha256:${invoice.sha256Short}|matched:${rule}` });
    }
    range.e.c = Math.max(range.e.c, first + checkedHeaders.length - 1);
    worksheet['!ref'] = XLSX.utils.encode_range(range);
    copy.Sheets[sheet] = worksheet;
  }
  return XLSX.write(copy, { type: 'array', bookType: 'xlsx', cellStyles: true });
}

import { normalizeBuyerName } from './invoice-buyer-check.js';
import { moneyCents } from './invoice-allocation.js';
import { supplementInvoiceCandidates, supplementType } from './invoice-supplements.js';
import { relativeLink } from './invoice-workbook-links.js';

const compact = value => String(value || '').normalize('NFKC').replace(/\s/g, '');
const medical = fields => /医疗|门诊/.test([fields.type, fields.docType, fields.sourcePath].join(' '));
export function sameInvoiceNumber(row, invoice) {
  const expected = compact(row.number), actual = compact(invoice.fields.number);
  if (row.numberUnsafe || !/^\d{8,25}$/.test(expected) || !/^\d{8,25}$/.test(actual)) return false;
  if (expected === actual) return true;
  return medical({ ...invoice.fields, sourcePath: invoice.sourcePath }) && [expected, actual].every(value => /^\d{8,10}$/.test(value)) && expected.replace(/^0+/, '') === actual.replace(/^0+/, '');
}

export function matchInvoiceFiles(rows, invoices) {
  const valid = invoices.filter(invoice => invoice.status === 'done');
  const originals = valid.filter(invoice => !supplementType(invoice.fields) && !invoice.duplicateReason);
  const supplements = valid.filter(invoice => supplementType(invoice.fields));
  const byRow = new Map(), byInvoice = new Map();
  const claims = new Map();
  const byHash = new Map();
  for (const invoice of originals) {
    if (!invoice.sha256Short) continue;
    const matches = byHash.get(invoice.sha256Short) || [];
    matches.push(invoice);
    byHash.set(invoice.sha256Short, matches);
  }
  for (const row of rows) {
    const exact = originals.filter(invoice => sameInvoiceNumber(row, invoice));
    let candidates = exact, rule = 'L1';
    if (!exact.length) {
      const expected = moneyCents(row.total), seller = normalizeBuyerName(row.seller);
      candidates = originals.filter(invoice => {
        const actual = moneyCents(invoice.fields.total);
        return (!row.number || row.numberUnsafe || !invoice.fields.number) && expected !== null && actual !== null && Math.abs(expected - actual) <= 100 && row.date && row.date === invoice.fields.date && seller && seller === normalizeBuyerName(invoice.fields.seller);
      });
      rule = 'L2';
    }
    const previous = byHash.get(row.prior?.hash);
    if (previous?.length === 1 && candidates.includes(previous[0]) && relativeLink(row.sourcePath, previous[0].sourcePath || previous[0].name) === row.prior.path) {
      candidates = previous;
    }
    if (candidates.length !== 1) continue;
    const [invoice] = candidates;
    if (!claims.has(invoice.id)) claims.set(invoice.id, []);
    claims.get(invoice.id).push({ row, invoice, rule });
  }
  for (const invoice of originals) {
    const choices = claims.get(invoice.id) || [];
    if (!choices.length) {
      byInvoice.set(invoice.id, { tone: 'danger', group: 'issue', label: '未入表原件', reason: '当前发票清单中没有唯一对应行，请核对票号、日期、金额或清单范围。' });
      continue;
    }
    if (choices.length !== 1) {
      byInvoice.set(invoice.id, { tone: 'warn', group: 'issue', label: '多行待核对', reason: '多个清单行指向同一张主票；未自动建立链接。' });
      continue;
    }
    const [match] = choices;
    const { row } = match, fields = invoice.fields;
    const excel = moneyCents(row.total), net = moneyCents(fields.amount), gross = moneyCents(fields.total);
    const netDifference = excel !== null && gross !== null && excel !== gross && excel === net;
    const problems = [
      excel !== null && gross !== null && excel !== gross && (netDifference ? `清单金额 ¥${row.total} 与票面不含税金额相同，票面价税合计为 ¥${fields.total}` : `清单金额 ¥${row.total} 与票面价税合计 ¥${fields.total} 不同`),
      row.buyer && fields.buyer && normalizeBuyerName(row.buyer) !== normalizeBuyerName(fields.buyer) && `清单购买方「${row.buyer}」与票面「${fields.buyer}」不同`,
    ].filter(Boolean);
    if (problems.length) byInvoice.set(invoice.id, { tone: 'warn', group: 'issue', label: netDifference ? '不含税差异' : '清单待核对', reason: problems.join('；'), netDifference: netDifference && problems.length === 1 });
    byRow.set(row.id, { ...match, supplements: [] });
  }
  const ledger = Object.fromEntries(originals.map(invoice => [invoice.id, invoice.fields]));
  const matchesById = new Map([...byRow.values()].map(match => [match.invoice.id, match]));
  for (const document of supplements) {
    const candidates = supplementInvoiceCandidates(document, ledger);
    const strong = candidates.filter(candidate => candidate.strong);
    if (strong.length === 1 && !candidates.some(candidate => candidate.conflict)) matchesById.get(strong[0].entry.key)?.supplements.push(document);
  }
  const supplementCounts = new Map([...matchesById].map(([id, match]) => [id, match.supplements.length]));
  return { byRow, byInvoice, supplementCounts };
}

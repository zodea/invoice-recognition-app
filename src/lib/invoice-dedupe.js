import { standaloneDocumentType } from './document-kind.js';
import { supplementType } from './invoice-supplements.js';
function normText(v) {
  return String(v || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim();
}

function normMoney(v) {
  if (v === "" || v == null) return "";
  const n = Number(String(v).replace(/[,，¥￥\s]/g, ""));
  return Number.isFinite(n) ? n.toFixed(2) : normText(v);
}

function invoiceDate(inv) {
  const f = inv.fields || inv || {};
  return normText(f.date || f.dateText);
}

function invoiceNumber(inv) {
  const f = inv.fields || inv || {};
  return normText(f.number);
}

export function invoiceContentFingerprint(inv) {
  const f = inv.fields || inv || {};
  const parts = [
    normText(f.docType || f.type),
    normText(f.seller),
    normText(f.buyer),
    normMoney(f.amount),
    normMoney(f.tax),
    normMoney(f.total),
    normText(f.rate),
    normText(f.remark),
  ];
  return parts.join("|");
}

function hasEnoughContent(inv) {
  const f = inv.fields || inv || {};
  return !!invoiceDate(inv)
    && !!normMoney(f.total)
    && (!!normText(f.seller) || !!normText(f.buyer))
    && (!!normMoney(f.amount) || !!normMoney(f.tax) || !!normText(f.docType || f.type));
}

export function isDuplicateInvoice(candidate, original) {
  if (!hasEnoughContent(candidate) || !hasEnoughContent(original)) return false;
  if (invoiceDate(candidate) !== invoiceDate(original)) return false;

  const aNo = invoiceNumber(candidate);
  const bNo = invoiceNumber(original);
  if (aNo && bNo && aNo !== bNo) return false;

  return invoiceContentFingerprint(candidate) === invoiceContentFingerprint(original);
}

// 只有号码完整且票面内容一致时才自动移除；其余疑似重复仍保留供人工核对。
export function confirmedDuplicateInvoices(invoices) {
  const seen = new Set();
  const duplicates = [];
  for (const inv of invoices) {
    if (inv.fields?.attachmentType || standaloneDocumentType(inv.fields) || inv.otherReceiptConfirmed) continue;
    const number = invoiceNumber(inv);
    if (inv.status !== "done" || !/^\d{18,25}$/.test(number)) continue;
    if (!hasEnoughContent(inv)) continue;
    const key = JSON.stringify([number, invoiceDate(inv), invoiceContentFingerprint(inv)]);
    if (seen.has(key)) duplicates.push(inv);
    else seen.add(key);
  }
  return duplicates;
}

export function markInvoiceDuplicates(invoices) {
  const groups = new Map();
  let count = 0;

  for (const inv of invoices) {
    inv.duplicateOfId = "";
    inv.duplicateReason = "";
    if (supplementType(inv.fields) || !hasEnoughContent(inv)) continue;
    const key = JSON.stringify([invoiceDate(inv), invoiceContentFingerprint(inv)]);
    const number = invoiceNumber(inv);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { first: inv, byNumber: new Map([[number, inv]]) });
      continue;
    }
    // An unnumbered receipt matches the first equivalent original. A numbered
    // receipt can also match an earlier original whose number was missing.
    const original = number ? group.byNumber.get(number) || group.byNumber.get('') : group.first;
    if (original) {
      inv.duplicateOfId = original.id || "";
      inv.duplicateReason = `疑似重复，已自动排除；与 ${original.name || "前一张发票"} 的日期和票面内容一致`;
      inv.include = false;
      count++;
    } else {
      group.byNumber.set(number, inv);
    }
  }

  return count;
}

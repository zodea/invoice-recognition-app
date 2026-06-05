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

export function markInvoiceDuplicates(invoices) {
  const originals = [];
  let count = 0;

  for (const inv of invoices) {
    inv.duplicateOfId = "";
    inv.duplicateReason = "";

    const original = originals.find((x) => isDuplicateInvoice(inv, x));
    if (original) {
      inv.duplicateOfId = original.id || "";
      inv.duplicateReason = `疑似重复，已自动排除；与 ${original.name || "前一张发票"} 的日期和票面内容一致`;
      inv.include = false;
      count++;
    } else {
      originals.push(inv);
    }
  }

  return count;
}

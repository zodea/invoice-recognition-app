import { saveLedgerAttachmentIfMissing } from "./ledger-attachments.js";

// 旧版八位号码必须同时核对发票代码；多文件或票面字段冲突留待人工核对。
export function planLedgerMatches(ledger, invoices) {
  const groups = new Map();
  for (const inv of invoices || []) {
    const number = String(inv.fields?.number || "").replace(/\s/g, "");
    if (inv.status !== "done" || !/^\d{8,25}$/.test(number) || !ledger[number] || !inv.blob) continue;
    const group = groups.get(number) || [];
    group.push(inv); groups.set(number, group);
  }
  const matches = [];
  let needsReview = 0;
  for (const [number, group] of groups) {
    const entry = ledger[number];
    const inv = group[0];
    const f = inv.fields || {};
    const code = String(f.code || "").trim();
    const ledgerCode = String(entry.code || "").trim();
    const date = String(f.date || "").slice(0, 10);
    const ledgerDate = String(entry.date || "").slice(0, 10);
    const totalKnown = f.total !== "" && f.total != null && entry.total !== "" && entry.total != null;
    const totalsConflict = totalKnown && Math.abs(Math.round(Number(f.total) * 100) - Math.round(Number(entry.total) * 100)) > 1;
    const codeConflict = code && ledgerCode && code !== ledgerCode;
    const shortUnverified = number.length < 18 && (!code || !ledgerCode || code !== ledgerCode);
    if (group.length !== 1 || codeConflict || shortUnverified || (date && ledgerDate && date !== ledgerDate) || totalsConflict) {
      needsReview++; continue;
    }
    matches.push({ key: number, file: inv.blob });
  }
  return { matches, needsReview };
}

export async function syncLedgerMatches(ledger, invoices, save = saveLedgerAttachmentIfMissing) {
  const { matches, needsReview } = planLedgerMatches(ledger, invoices);
  let saved = 0, existing = 0, failed = 0;
  for (const { key, file } of matches) {
    try { if (await save(key, file)) saved++; else existing++; }
    catch { failed++; }
  }
  return { matched: matches.length, saved, existing, needsReview, failed };
}

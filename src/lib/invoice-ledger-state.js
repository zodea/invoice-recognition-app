import { appStorage } from './app-storage.js';
import { isMultiProject, projectAllocationState } from './invoice-allocation.js';
import { allocationKind } from './payment-allocation.js';
// 历史发票台账（本地持久化）：跨批次按「发票号码」查重，避免同一张发票被重复报销/使用；
// 并支持导入电子税务局导出的「已认证发票清单」标记认证状态，导出历史报表。
//
// 说明：中国增值税发票综合服务平台（认证/抵扣）需 CA 证书+企业实名登录，无对外公开 API，
// 第三方程序无法直接联机查询。这里走“本地台账 + 导入官方清单”的稳妥方案。
import { invoiceProblems } from "./invoice-review.js";
import { inferExpenseTag } from "./invoice-tags.js";

const LS_KEY = "invoiceLedger.v1";

// 桌面版由 appStorage 写入软件旁的便携数据目录。
export function loadLedger() {
  try {
    const raw = typeof localStorage !== "undefined" ? appStorage.getItem(LS_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
export function saveLedger(ledger) {
  try {
    if (typeof localStorage !== "undefined") appStorage.setItem(LS_KEY, JSON.stringify(ledger || {}));
  } catch (e) {
    throw new Error(`台账保存失败，请检查本地存储空间：${e.message || e}`);
  }
}

function fields(inv) {
  return (inv && inv.fields) || inv || {};
}
export const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);

export function uniqueAppend(list, item, keyFn = JSON.stringify) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const key = keyFn(item);
  if (!arr.some((x) => keyFn(x) === key)) arr.push(item);
  return arr;
}

export function cellText(value) {
  if (value == null) return "";
  return String(value).trim();
}

export function deductionStatus(entry) {
  const selection = cellText(entry?.officialSelection);
  const time = cellText(entry?.selectionTime);
  if ((time && !/^(--|—|无|暂无|未勾选|未认证)$/.test(time)) || /^(是|已勾选|已认证)$/.test(selection)) return "已抵税";
  if (/^(否|未勾选|未认证)$/.test(selection)) return "未勾选";
  if (entry?.verified) return "已抵税";
  return "未知";
}

export function missingReimbursementFields(entry) {
  const missing = isMultiProject(entry) && !projectAllocationState(entry).complete ? ['工地分配未完成'] : [];
  return missing.concat([["reimburser", "报销人"], ["project", "工地"], ["purpose", "用途"]]
    .filter(([key]) => key === "project" ? ["指定工地", "待确认"].includes(allocationKind(entry)) && !cellText(entry?.project) : !cellText(entry?.[key])).map(([, label]) => label));
}

export function markReimbursedBatch(ledger, keys, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + "T00:00:00")) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw new Error("请选择有效的报销日期。");
  const next = { ...(ledger || {}) };
  let marked = 0, already = 0, missing = 0;
  for (const key of new Set(keys || [])) {
    const entry = next[key];
    if (!entry) { missing++; continue; }
    if (entry.reimbursement === "已报销") { already++; continue; }
    next[key] = { ...entry, reimbursement: "已报销", reimbursementDate: date };
    marked++;
  }
  return { ledger: next, marked, already, missing };
}

// 识别界面既可能有匹配的台账，也可能是尚未建档的发票。
export function updateCurrentReimbursements(ledger, invoices, action, date = "") {
  if (!["mark", "cancel"].includes(action)) throw new Error("无效操作。");
  if (action === "mark") markReimbursedBatch({}, [], date);
  const next = { ...(ledger || {}) };
  const groups = new Map();
  let skipped = 0, unchanged = 0, changed = 0;
  for (const inv of invoices || []) {
    const number = String(fields(inv).number || "").replace(/\s/g, "");
    if (inv.status !== "done" || !/^\d{8,25}$/.test(number)) { skipped++; continue; }
    const group = groups.get(number) || [];
    group.push(inv); groups.set(number, group);
  }
  for (const [number, group] of groups) {
    if (group.length !== 1) { skipped += group.length; continue; }
    const inv = group[0];
    const prev = next[number];
    const status = historyStatus(next, inv);
    if (status.needsReview || (!prev && number.length < 18)) { skipped++; continue; }
    if (action === "cancel") {
      if (!prev || prev.reimbursement !== "已报销") { unchanged++; continue; }
      next[number] = { ...prev, reimbursement: "未核对", reimbursementDate: "" };
    } else {
      if (prev?.reimbursement === "已报销") { unchanged++; continue; }
      const entry = prev || { ...entryFromInvoice(inv, date), verified: false, printed: false, batches: [] };
      next[number] = { ...entry, key: number, number, expenseTag: entry.expenseTagSet ? entry.expenseTag : (entry.expenseTag || inferExpenseTag(inv)), reimbursement: "已报销", reimbursementDate: date };
    }
    changed++;
  }
  return { ledger: next, changed, unchanged, skipped };
}

export function setInvoiceExpenseTag(ledger, inv, tag) {
  const number = String(fields(inv).number || "").replace(/\s/g, "");
  if (inv.status !== "done" || !/^\d{8,25}$/.test(number)) return null;
  const prev = (ledger || {})[number];
  if (historyStatus(ledger, inv).needsReview || (!prev && number.length < 18)) return null;
  const entry = prev || { ...entryFromInvoice(inv, ""), verified: false, printed: false, batches: [] };
  return { ...(ledger || {}), [number]: { ...entry, key: number, number, expenseTag: tag, expenseTagSet: true } };
}

export function money(value) {
  if (value === "" || value == null || value === "--") return "";
  const n = Number(String(value).replace(/[,\s¥￥]/g, ""));
  return Number.isFinite(n) ? round2(n) : "";
}

function entryFromInvoice(inv, day) {
  const f = fields(inv);
  const key = ledgerKey(inv);
  return {
    key,
    number: f.number || "",
    code: f.code || "",
    date: f.date || f.dateText || "",
    seller: f.seller || "",
    buyer: f.buyer || "",
    amount: money(f.amount),
    tax: money(f.tax),
    total: money(f.total),
    rate: f.rate || "",
    type: f.taxKind || f.type || f.docType || "",
    service: f.category || f.service || "",
    firstSeen: day,
  };
}

// 主键：优先发票号码；无号码退化为 内容指纹（日期|金额|销售方）
export function ledgerKey(inv) {
  const f = fields(inv);
  const no = String(f.number || "").replace(/\s/g, "").trim();
  if (no) return no;
  return ["fp", f.date || f.dateText || "", round2(f.total), (f.seller || "").replace(/\s/g, "")].join("|");
}

// 在台账里查该发票的历史：是否曾被记入(usedBefore)、是否已认证(verified)、用过哪些批次
export function historyStatus(ledger, inv) {
  const e = (ledger || {})[ledgerKey(inv)];
  if (!e) return { usedBefore: false, verified: false, printed: false, batches: [], entry: null };
  const f = fields(inv);
  const no = String(f.number || "").replace(/\s/g, "");
  const code = String(f.code || "").trim();
  const ledgerCode = String(e.code || "").trim();
  const date = String(f.date || "").slice(0, 10);
  const ledgerDate = String(e.date || "").slice(0, 10);
  const totalsKnown = f.total !== "" && f.total != null && e.total !== "" && e.total != null;
  if ((no && no.length < 18 && (!code || !ledgerCode || code !== ledgerCode)) ||
      (code && ledgerCode && code !== ledgerCode) || (date && ledgerDate && date !== ledgerDate) ||
      (totalsKnown && Math.abs(Math.round(Number(f.total) * 100) - Math.round(Number(e.total) * 100)) > 1)) {
    return { usedBefore: false, verified: false, printed: false, batches: [], entry: null, needsReview: true };
  }
  const batches = e.batches || [];
  return {
    usedBefore: batches.length > 0 || !!e.printed || deductionStatus(e) === "已抵税" || e.reimbursement === "已报销",
    verified: deductionStatus(e) === "已抵税",
    printed: !!e.printed,
    batches,
    entry: e,
  };
}

export function shouldDefaultExcludeByHistory(ledger, inv) {
  const status = historyStatus(ledger, inv);
  return !!(status.printed || status.verified || status.entry?.reimbursement === "已报销");
}

// 红字发票与原蓝票被冲红是不同状态，仅依据来源字段或负数金额标识。
export function redInvoiceStatus(entry) {
  const status = String(entry?.invoiceStatus || "");
  if (/部分.*冲红|部分.*红冲/.test(status)) return "部分冲红";
  if (/冲红|红冲/.test(status)) return "已冲红";
  const value = String(entry?.redBlue || "").trim();
  if (/红字|负数/.test(value) || value === "否" || [entry?.amount, entry?.total, entry?.tax].some(v => v !== "" && v != null && Number(v) < 0)) return "红字发票";
  return "";
}

// 把本批发票记入台账（标记“已用/已报销”），返回 { ledger, added, repeated }
export function recordInvoices(ledger, invoices, batch = {}) {
  const invalid = (invoices || []).find(inv => invoiceProblems(fields(inv)).length);
  if (invalid) throw new Error("发票尚未通过复核：" + invoiceProblems(fields(invalid)).join("、"));
  const next = { ...(ledger || {}) };
  const batchName = batch.name || "";
  const batchDate = batch.date || new Date().toISOString().slice(0, 10);
  let added = 0, repeated = 0;
  for (const inv of invoices || []) {
    const f = fields(inv);
    const key = ledgerKey(inv);
    const prev = next[key];
    const entry = prev
      ? { ...prev, batches: [...(prev.batches || [])] }
      : { key, number: f.number || "", date: f.date || f.dateText || "", seller: f.seller || "", buyer: f.buyer || "", total: round2(f.total), type: f.taxKind || f.type || f.docType || "", verified: false, printed: false, firstSeen: batchDate, batches: [] };
    if (prev) repeated++; else added++;
    // 同一批次不重复登记
    if (!entry.batches.some((b) => b.name === batchName && b.date === batchDate)) {
      entry.batches.push({ name: batchName, date: batchDate });
    }
    entry.lastUsed = batchDate;
    entry.printed = true;
    entry.printedAt = entry.printedAt || batchDate;
    // 补全可能后来才识别出的字段
    entry.number = entry.number || f.number || "";
    entry.seller = entry.seller || f.seller || "";
    entry.buyer = entry.buyer || f.buyer || "";
    if (!entry.total) entry.total = round2(f.total);
    next[key] = entry;
  }
  return { ledger: next, added, repeated };
}

export function markPrintedInvoices(ledger, invoices, batch = {}) {
  const next = { ...(ledger || {}) };
  const batchName = batch.name || "打印批次";
  const batchDate = batch.date || today();
  let added = 0, updated = 0;
  for (const inv of invoices || []) {
    const base = entryFromInvoice(inv, batchDate);
    const prev = next[base.key];
    const entry = {
      ...(prev || {}),
      ...base,
      ...(prev?.reviewedAt ? Object.fromEntries(["buyer","seller","date","type","amount","tax","total"].map(k=>[k,prev[k]])) : {}),
      verified: !!prev?.verified,
      verifiedAt: prev?.verifiedAt || "",
      printed: true,
      printedAt: prev?.printedAt || batchDate,
      firstSeen: prev?.firstSeen || base.firstSeen,
      importSources: prev?.importSources || [],
      batches: prev?.batches || [],
    };
    entry.batches = uniqueAppend(entry.batches, { name: batchName, date: batchDate, type: "打印" }, (x) => `${x.name}|${x.date}|${x.type || ""}`);
    entry.lastUsed = batchDate;
    next[base.key] = entry;
    if (prev) updated++; else added++;
  }
  return { ledger: next, added, updated, printed: (invoices || []).length };
}

// 从导入的表格行(二维数组)里抓“发票号码”（数电20位 / 旧版8位等），用于标认证
export function parseVerifiedNumbers(rows) {
  const out = new Set();
  for (const r of rows || []) {
    for (const c of r || []) {
      const s = String(c == null ? "" : c).replace(/\s/g, "");
      if (/^\d{8,25}$/.test(s)) out.add(s);
      else {
        const m = s.match(/\d{18,25}/g);
        if (m) m.forEach((x) => out.add(x));
      }
    }
  }
  return [...out];
}

// 用一批发票号码标记“已认证”，返回 { ledger, matched, unmatched }
export function markVerified(ledger, numbers, when) {
  const next = { ...(ledger || {}) };
  const day = when || new Date().toISOString().slice(0, 10);
  let matched = 0;
  const unmatched = [];
  for (const raw of numbers || []) {
    const no = String(raw || "").replace(/\s/g, "").trim();
    if (!no) continue;
    if (next[no]) {
      next[no] = { ...next[no], verified: true, printed: true, verifiedAt: next[no].verifiedAt || day, printedAt: next[no].printedAt || day };
      matched++;
    } else {
      // 台账里还没有这张：也记一条“仅认证”占位，便于后续比对避免重复使用
      next[no] = { key: no, number: no, date: "", seller: "", buyer: "", total: "", type: "", verified: true, printed: true, verifiedAt: day, printedAt: day, firstSeen: day, batches: [] };
      unmatched.push(no);
    }
  }
  return { ledger: next, matched, unmatched: unmatched.length };
}

export function ledgerStats(ledger) {
  const entries = Object.values(ledger || {});
  return {
    total: entries.length,
    verified: entries.filter((e) => deductionStatus(e) === "已抵税").length,
    printed: entries.filter((e) => e.printed).length,
    used: entries.filter((e) => (e.batches || []).length || e.printed || deductionStatus(e) === "已抵税").length,
    repeated: entries.filter((e) => (e.batches || []).length > 1).length,
  };
}

export function currentInputReportName() {
  return `当前进项发票状态_${today()}.xlsx`;
}

export function historyReportName() {
  const d = new Date();
  return `历史发票台账_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`;
}

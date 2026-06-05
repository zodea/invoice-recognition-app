// 历史发票台账（本地持久化）：跨批次按「发票号码」查重，避免同一张发票被重复报销/使用；
// 并支持导入电子税务局导出的「已认证发票清单」标记认证状态，导出历史报表。
//
// 说明：中国增值税发票综合服务平台（认证/抵扣）需 CA 证书+企业实名登录，无对外公开 API，
// 第三方程序无法直接联机查询。这里走“本地台账 + 导入官方清单”的稳妥方案。
import * as XLSX from "xlsx";

const LS_KEY = "invoiceLedger.v1";

// —— 持久化（localStorage；Tauri WebView2 同样会持久化到应用数据目录）——
export function loadLedger() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
export function saveLedger(ledger) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, JSON.stringify(ledger || {}));
  } catch (e) {
    /* 忽略 */
  }
}

function fields(inv) {
  return (inv && inv.fields) || inv || {};
}
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

function uniqueAppend(list, item, keyFn = JSON.stringify) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const key = keyFn(item);
  if (!arr.some((x) => keyFn(x) === key)) arr.push(item);
  return arr;
}

function normHeader(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "").trim();
}

function cellText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function dateText(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = cellText(value);
  const m = s.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function money(value) {
  if (value === "" || value == null || value === "--") return "";
  const n = Number(String(value).replace(/[,\s¥￥]/g, ""));
  return Number.isFinite(n) ? round2(n) : "";
}

const COLUMN_ALIASES = {
  number: ["发票号码", "发票号"],
  code: ["发票代码"],
  invoiceType: ["发票种类", "发票类型"],
  date: ["开票日期", "发票日期"],
  seller: ["销方名称", "销售方名称", "销售方"],
  buyer: ["购方名称", "购买方名称", "购买方"],
  inputType: ["进项类型"],
  service: ["货物、应税劳务及服务", "货物应税劳务及服务", "项目名称", "商品和服务名称"],
  amount: ["不含税金额", "金额"],
  rate: ["税率", "税率/征收率"],
  tax: ["税额"],
  validTax: ["有效税额"],
  addDeductTax: ["加计扣除税额"],
  total: ["价税合计", "合计金额"],
  redBlue: ["红字蓝字"],
  invoiceStatus: ["发票状态", "状态"],
};

function findHeader(rows) {
  for (let i = 0; i < (rows || []).length; i++) {
    const headers = (rows[i] || []).map(normHeader);
    if (headers.includes("发票号码") && headers.some((h) => h.includes("开票日期"))) {
      const map = {};
      for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
        const idx = headers.findIndex((h) => names.some((name) => h === normHeader(name)));
        if (idx >= 0) map[field] = idx;
      }
      return { rowIndex: i, map };
    }
  }
  return { rowIndex: -1, map: {} };
}

function buyerFromTitle(rows, headerIndex) {
  for (let i = 0; i < Math.max(0, headerIndex); i++) {
    for (const c of rows[i] || []) {
      const s = cellText(c);
      const m = s.match(/^(.+?)进项发票清单$/);
      if (m) return m[1].trim();
    }
  }
  return "";
}

function pick(row, map, key) {
  const idx = map[key];
  return idx == null ? "" : row[idx];
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
  const batches = e.batches || [];
  return {
    usedBefore: batches.length > 0 || !!e.printed || !!e.verified,
    verified: !!e.verified,
    printed: !!e.printed,
    batches,
    entry: e,
  };
}

export function shouldDefaultExcludeByHistory(ledger, inv) {
  const status = historyStatus(ledger, inv);
  return !!(status.printed || status.verified);
}

// 把本批发票记入台账（标记“已用/已报销”），返回 { ledger, added, repeated }
export function recordInvoices(ledger, invoices, batch = {}) {
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

export function parseInputInvoiceRows(rows, { sourceName = "进项发票导入", importedAt = today() } = {}) {
  const { rowIndex, map } = findHeader(rows);
  if (rowIndex < 0 || map.number == null) return [];
  const defaultBuyer = buyerFromTitle(rows, rowIndex);
  const entries = [];
  for (const row of rows.slice(rowIndex + 1)) {
    const number = String(pick(row, map, "number") || "").replace(/\s/g, "").trim();
    if (!number || !/^\d{8,25}$/.test(number)) continue;
    entries.push({
      key: number,
      number,
      code: cellText(pick(row, map, "code")),
      date: dateText(pick(row, map, "date")),
      seller: cellText(pick(row, map, "seller")),
      buyer: cellText(pick(row, map, "buyer")) || defaultBuyer,
      amount: money(pick(row, map, "amount")),
      tax: money(pick(row, map, "tax")),
      total: money(pick(row, map, "total")),
      rate: cellText(pick(row, map, "rate")),
      type: cellText(pick(row, map, "invoiceType")),
      inputType: cellText(pick(row, map, "inputType")),
      service: cellText(pick(row, map, "service")),
      validTax: money(pick(row, map, "validTax")),
      addDeductTax: money(pick(row, map, "addDeductTax")),
      redBlue: cellText(pick(row, map, "redBlue")),
      invoiceStatus: cellText(pick(row, map, "invoiceStatus")),
      verified: true,
      verifiedAt: importedAt,
      printed: true,
      printedAt: importedAt,
      firstSeen: importedAt,
      importSources: [{ name: sourceName, date: importedAt }],
      batches: [],
    });
  }
  return entries;
}

export function importInputInvoiceRows(ledger, rows, opts = {}) {
  const imported = parseInputInvoiceRows(rows, opts);
  const next = { ...(ledger || {}) };
  let added = 0;
  let updated = 0;
  for (const item of imported) {
    const prev = next[item.key];
    const entry = {
      ...(prev || {}),
      ...item,
      verified: true,
      printed: true,
      batches: prev?.batches || item.batches || [],
      importSources: uniqueAppend(prev?.importSources, item.importSources[0], (x) => `${x.name}|${x.date}`),
      firstSeen: prev?.firstSeen || item.firstSeen,
      verifiedAt: prev?.verifiedAt || item.verifiedAt,
      printedAt: prev?.printedAt || item.printedAt,
    };
    next[item.key] = entry;
    if (prev) updated++; else added++;
  }
  return { ledger: next, imported: imported.length, added, updated };
}

export function importInputInvoiceWorkbookBytes(ledger, bytes, opts = {}) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  let next = ledger || {};
  let imported = 0, added = 0, updated = 0;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    const r = importInputInvoiceRows(next, rows, opts);
    next = r.ledger;
    imported += r.imported;
    added += r.added;
    updated += r.updated;
  }
  return { ledger: next, imported, added, updated };
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
    verified: entries.filter((e) => e.verified).length,
    printed: entries.filter((e) => e.printed).length,
    used: entries.filter((e) => (e.batches || []).length || e.printed || e.verified).length,
    repeated: entries.filter((e) => (e.batches || []).length > 1).length,
  };
}

// 导出历史发票报表（含认证状态 / 使用批次 / 是否重复使用）
export function buildHistoryReportBytes(ledger) {
  const wb = XLSX.utils.book_new();
  const header = ["发票号码", "开票日期", "销售方", "购买方", "不含税金额", "税率", "税额", "价税合计", "发票种类", "进项类型", "货物/劳务/服务", "发票状态", "认证状态", "认证日期", "是否已打印", "打印日期", "使用批次数", "最近使用", "是否重复使用", "导入来源", "使用批次"];
  const rows = [header];
  const entries = Object.values(ledger || {}).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  let total = 0, verifiedCount = 0, printedCount = 0, repeatCount = 0;
  for (const e of entries) {
    const used = (e.batches || []).length;
    const repeat = used > 1;
    if (e.verified) verifiedCount++;
    if (e.printed) printedCount++;
    if (repeat) repeatCount++;
    total += Number(e.total) || 0;
    rows.push([
      e.number || e.key || "", e.date || "", e.seller || "", e.buyer || "",
      e.amount === "" || e.amount == null ? "" : Number(e.amount),
      e.rate || "",
      e.tax === "" || e.tax == null ? "" : Number(e.tax),
      e.total === "" || e.total == null ? "" : Number(e.total),
      e.type || "", e.inputType || "", e.service || "", e.invoiceStatus || "",
      e.verified ? "已认证" : "未认证", e.verifiedAt || "",
      e.printed ? "已打印" : "未打印", e.printedAt || "",
      used, e.lastUsed || "", repeat ? "是" : "",
      (e.importSources || []).map((s) => s.name || s.date).filter(Boolean).join("；"),
      (e.batches || []).map((b) => b.name || b.date).filter(Boolean).join("；"),
    ]);
  }
  rows.push([]);
  rows.push(["合计", "", "", "", "", "", "", round2(total), "", "", "", "", `已认证 ${verifiedCount}`, "", `已打印 ${printedCount}`, "", "", "", `重复使用 ${repeatCount}`, "", `共 ${entries.length} 张`]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 11 }, { wch: 28 }, { wch: 28 }, { wch: 12 }, { wch: 8 }, { wch: 10 },
    { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 9 }, { wch: 11 },
    { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 30 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "历史发票台账");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

export function buildCurrentInputInvoiceReportBytes(invoices, ledger) {
  const wb = XLSX.utils.book_new();
  const header = ["序号", "发票号码", "开票日期", "销售方", "购买方", "金额", "税额", "价税合计", "类型", "是否本次勾选", "历史认证", "历史已打印", "历史使用批次", "来源文件", "系统备注"];
  const rows = [header];
  for (const [i, inv] of (invoices || []).entries()) {
    const f = inv.fields || {};
    const st = historyStatus(ledger, inv);
    rows.push([
      i + 1,
      f.number || "",
      f.date || f.dateText || "",
      f.seller || "",
      f.buyer || "",
      money(f.amount),
      money(f.tax),
      money(f.total),
      f.taxKind || f.type || f.docType || "",
      inv.include ? "是" : "否",
      st.verified ? "已认证" : "未认证",
      st.printed ? "已打印" : "未打印",
      (st.batches || []).map((b) => b.name || b.date).filter(Boolean).join("；"),
      inv.name || "",
      [inv.systemNote, inv.duplicateReason].filter(Boolean).join("；"),
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 5 }, { wch: 22 }, { wch: 11 }, { wch: 28 }, { wch: 28 },
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 26 }, { wch: 28 }, { wch: 26 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "当前进项发票状态");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

export function currentInputReportName() {
  return `当前进项发票状态_${today()}.xlsx`;
}

export function historyReportName() {
  const d = new Date();
  return `历史发票台账_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.xlsx`;
}

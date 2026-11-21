import * as XLSX from 'xlsx/xlsx.mjs';
import { isMultiProject, projectAllocationState, projectNames, projectExpenseRows } from './invoice-allocation.js';
import { allocationKind } from './payment-allocation.js';
import { isAssignmentWorkbook } from './expense-assignment-import.js';
import { today, money, round2, cellText, uniqueAppend, deductionStatus, historyStatus, redInvoiceStatus } from './invoice-ledger-state.js';
export * from './invoice-ledger-state.js';

function normHeader(value) {
  return String(value == null ? "" : value).replace(/\s+/g, "").replace(/[＊*]/g, "").trim();
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

const COLUMN_ALIASES = {
  selection: ["是否勾选", "勾选状态"],
  number: ["数电发票号码", "发票号码", "发票号"],
  code: ["发票代码"],
  invoiceType: ["发票种类", "发票类型", "发票票种", "票种"],
  typeLabel: ["票种标签"],
  date: ["开票日期", "发票日期"],
  seller: ["销方名称", "销售方名称", "销售方纳税人名称", "销售方"],
  buyer: ["购方名称", "购买方名称", "购买方"],
  inputType: ["进项类型"],
  service: ["货物、应税劳务及服务", "货物或应税劳务名称", "货物应税劳务及服务", "项目名称", "商品和服务名称"],
  specification: ["规格型号"],
  unit: ["单位"],
  quantity: ["数量"],
  unitPrice: ["单价"],
  amount: ["不含税金额", "金额"],
  rate: ["税率", "税率/征收率"],
  tax: ["税额", "票面税额"],
  validTax: ["有效抵扣税额", "有效税额"],
  selectionTime: ["勾选时间"],
  addDeductTax: ["加计扣除税额"],
  total: ["价税合计", "合计金额"],
  redBlue: ["红字蓝字", "是否正数发票"],
  invoiceStatus: ["发票状态", "状态"],
};

function findHeader(rows) {
  for (let i = 0; i < (rows || []).length; i++) {
    const headers = (rows[i] || []).map(normHeader);
    if ((headers.includes("发票号码") || headers.includes("数电发票号码")) && headers.some((h) => h.includes("开票日期"))) {
      const map = {};
      for (const [field, names] of Object.entries(COLUMN_ALIASES)) {
        const idx = names
          .map((name) => headers.findIndex((h) => h === normHeader(name)))
          .find((n) => n >= 0);
        if (idx >= 0) map[field] = idx;
      }
      const legacyNumber = headers.findIndex((h) => h === "发票号码");
      if (legacyNumber >= 0 && legacyNumber !== map.number) map.numberFallback = legacyNumber;
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
    const row = rows[i] || [];
    const label = row.findIndex((c) => cellText(c) === "纳税人名称");
    if (label >= 0 && cellText(row[label + 1])) return cellText(row[label + 1]);
  }
  return "";
}

function pick(row, map, key) {
  const idx = map[key];
  return idx == null ? "" : row[idx];
}

function invoiceNumber(row, map) {
  const candidates = [pick(row, map, "number"), row[map.numberFallback]];
  for (const value of candidates) {
    const no = String(value || "").replace(/\s/g, "").trim();
    if (/^\d{8,25}$/.test(no)) return no;
  }
  return "";
}

export function parseInputInvoiceRows(rows, { sourceName = "进项发票导入", importedAt = today() } = {}) {
  const { rowIndex, map } = findHeader(rows);
  if (rowIndex < 0 || map.number == null) return [];
  const defaultBuyer = buyerFromTitle(rows, rowIndex);
  const entries = [];
  for (const row of rows.slice(rowIndex + 1)) {
    const number = invoiceNumber(row, map);
    if (!number) continue;
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
      typeLabel: cellText(pick(row, map, "typeLabel")),
      inputType: cellText(pick(row, map, "inputType")),
      service: cellText(pick(row, map, "service")),
      specification: cellText(pick(row, map, "specification")),
      unit: cellText(pick(row, map, "unit")),
      quantity: cellText(pick(row, map, "quantity")),
      unitPrice: cellText(pick(row, map, "unitPrice")),
      validTax: money(pick(row, map, "validTax")),
      addDeductTax: money(pick(row, map, "addDeductTax")),
      redBlue: cellText(pick(row, map, "redBlue")),
      invoiceStatus: cellText(pick(row, map, "invoiceStatus")),
      officialSelection: cellText(pick(row, map, "selection")),
      selectionTime: cellText(pick(row, map, "selectionTime")),
      verified: deductionStatus({ officialSelection: pick(row, map, "selection"), selectionTime: pick(row, map, "selectionTime") }) === "已抵税",
      verifiedAt: "",
      printed: false,
      printedAt: "",
      firstSeen: importedAt,
      importSources: [{ name: sourceName, date: importedAt }],
      batches: [],
    });
  }
  return entries;
}

function mergeInputEntries(ledger, imported) {
  const next = { ...(ledger || {}) };
  let added = 0;
  let updated = 0;
  for (const item of imported) {
    const prev = next[item.key];
    // 不用空白覆盖已有数据，支持不同官方表格互相补充。
    const populated = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== "" && value != null));
    const entry = {
      ...(prev || {}),
      ...populated,
      ...(prev?.reviewedAt ? Object.fromEntries(["buyer","seller","date","type","amount","tax","total"].map(k=>[k,prev[k]])) : {}),
      officialSelection: item.officialSelection || prev?.officialSelection || "",
      verified: deductionStatus({ officialSelection: item.officialSelection || prev?.officialSelection, selectionTime: item.selectionTime || prev?.selectionTime, verified: item.officialSelection ? item.verified : !!prev?.verified }) === "已抵税",
      printed: !!prev?.printed,
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

export function importInputInvoiceRows(ledger, rows, opts = {}) {
  return mergeInputEntries(ledger, parseInputInvoiceRows(rows, opts));
}

// 明细工作表的金额属于每行商品；同一号码聚合为一张票并保留各行。
function groupInvoiceDetails(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!grouped.has(entry.key)) grouped.set(entry.key, []);
    grouped.get(entry.key).push(entry);
  }
  return [...grouped.values()].map(items => {
    const first = items[0];
    const sum = field => items.every(e => e[field] !== "" && e[field] != null)
      ? round2(items.reduce((value, e) => value + Number(e[field]), 0)) : "";
    return {
      ...first,
      amount: sum("amount"), tax: sum("tax"), total: sum("total"),
      service: items.map(e => e.service).filter(Boolean).join("；"),
      details: items.map(e => ({ service: e.service, specification: e.specification, unit: e.unit, quantity: e.quantity, unitPrice: e.unitPrice, amount: e.amount, tax: e.tax, total: e.total, rate: e.rate })),
    };
  });
}

export function importInputInvoiceWorkbookBytes(ledger, bytes, opts = {}) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  if(isAssignmentWorkbook(wb))throw new Error("这是归属导入表，请使用批量导入归属，不能当作进项发票导入");
  let next = ledger || {};
  let imported = 0, added = 0, updated = 0;
  const preferredSheet = wb.SheetNames.find((n) => n === "发票基础信息")
    || wb.SheetNames.find((n) => n === "信息汇总表");
  const sheetNames = preferredSheet ? [preferredSheet] : wb.SheetNames;
  for (const sheetName of sheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "", raw: false });
    const options = { ...opts, sourceName: `${opts.sourceName || "进项发票导入"}:${sheetName}` };
    const parsed = parseInputInvoiceRows(rows, options);
    const r = mergeInputEntries(next, sheetName === "信息汇总表" ? groupInvoiceDetails(parsed) : parsed);
    next = r.ledger;
    imported += r.imported;
    added += r.added;
    updated += r.updated;
  }
  // 基础表提供整票金额，汇总表提供商品行，不能把两者重复相加。
  if (preferredSheet === "发票基础信息" && wb.Sheets["信息汇总表"]) {
    const baseRows = XLSX.utils.sheet_to_json(wb.Sheets[preferredSheet], { header: 1, defval: "", raw: false });
    const baseKeys = new Set(parseInputInvoiceRows(baseRows).map(e => e.key));
    const detailRows = XLSX.utils.sheet_to_json(wb.Sheets["信息汇总表"], { header: 1, defval: "", raw: false });
    const groups = groupInvoiceDetails(parseInputInvoiceRows(detailRows, { ...opts, sourceName: `${opts.sourceName || "进项发票导入"}:信息汇总表` }));
    for (const group of groups) {
      if (baseKeys.has(group.key)) {
        next[group.key] = { ...next[group.key], details: group.details, service: group.service || next[group.key].service || "" };
      } else {
        const r = mergeInputEntries(next, [group]);
        next = r.ledger; imported += r.imported; added += r.added; updated += r.updated;
      }
    }
  }
  return { ledger: next, imported, added, updated };
}

// 导出历史发票报表（含认证状态 / 使用批次 / 是否重复使用）
export function buildHistoryReportBytes(ledger) {
  const wb = XLSX.utils.book_new();
  const header = ["发票号码", "开票日期", "销售方", "购买方", "不含税金额", "税率", "税额", "价税合计", "发票种类", "进项类型", "货物/劳务/服务", "发票状态", "抵税状态", "认证日期", "是否已打印", "打印日期", "使用批次数", "最近使用", "是否重复使用", "导入来源", "使用批次", "官方勾选状态", "报销状态", "工地", "支付方式", "标签", "有效抵扣税额", "票种标签", "勾选时间", "红字蓝字", "红冲标记", "报销人", "用途"];
  header.push("付款账户 / 付款人", "报销日期", "费用标签", "报销期间", "费用归属", "复核时间", "工地分配状态");
  const rows = [header];
  const entries = Object.values(ledger || {}).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  let total = 0, verifiedCount = 0, printedCount = 0, repeatCount = 0;
  for (const e of entries) {
    const used = (e.batches || []).length;
    const repeat = used > 1;
    if (deductionStatus(e) === "已抵税") verifiedCount++;
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
      deductionStatus(e), e.verifiedAt || "",
      e.printed ? "已打印" : "未打印", e.printedAt || "",
      used, e.lastUsed || "", repeat ? "是" : "",
      (e.importSources || []).map((s) => s.name || s.date).filter(Boolean).join("；"),
      (e.batches || []).map((b) => b.name || b.date).filter(Boolean).join("；"),
      e.officialSelection || "", e.reimbursement || "未核对", projectNames(e), e.payment || "", e.tags || "",
      e.validTax === "" || e.validTax == null ? "" : Number(e.validTax), e.typeLabel || "", e.selectionTime || "", e.redBlue || "", redInvoiceStatus(e), e.reimburser || "", e.purpose || "", e.payer || "", e.reimbursementDate || "", e.expenseTag || "", e.reimbursementPeriod || "", allocationKind(e), e.reviewedAt || "", isMultiProject(e) ? projectAllocationState(e).label : "",
    ]);
  }
  rows.push([]);
  rows.push(["合计", "", "", "", "", "", "", round2(total), "", "", "", "", `已抵税 ${verifiedCount}`, "", `已打印 ${printedCount}`, "", "", "", `重复使用 ${repeatCount}`, "", `共 ${entries.length} 张`]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 22 }, { wch: 11 }, { wch: 28 }, { wch: 28 }, { wch: 12 }, { wch: 8 }, { wch: 10 },
    { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 9 }, { wch: 11 },
    { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 30 }, { wch: 30 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "历史发票台账");
  const allocationRows = [['发票号码', '开票日期', '销售方', '购买方', '工地 / 费用归属', '分配金额（含税）', '分配备注', '分配状态', '报销状态']];
  for (const entry of entries) {
    for (const row of projectExpenseRows(entry)) allocationRows.push([entry.number || entry.key, entry.date || '', entry.seller || '', entry.buyer || '', isMultiProject(entry) ? row.project : allocationKind(entry) === '指定工地' ? row.project : allocationKind(entry), row.total, row.remark, isMultiProject(entry) ? projectAllocationState(entry).label : '单一归属', entry.reimbursement || '未核对']);
  }
  const allocationSheet = XLSX.utils.aoa_to_sheet(allocationRows);
  allocationSheet['!cols'] = [22,12,28,28,24,20,30,12,12].map(wch => ({wch}));
  XLSX.utils.book_append_sheet(wb, allocationSheet, '工地分配明细');
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

export function buildCurrentInputInvoiceReportBytes(invoices, ledger) {
  const wb = XLSX.utils.book_new();
  const header = ["序号", "发票号码", "开票日期", "销售方", "购买方", "金额", "税额", "价税合计", "类型", "是否本次勾选", "历史抵税状态", "历史已打印", "历史使用批次", "来源文件", "系统备注"];
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
      st.entry ? deductionStatus(st.entry) : "未知",
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

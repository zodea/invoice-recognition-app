// 发票：开票明细表 + 汇总账单表（按销售方汇总）。
import * as XLSX from "xlsx";

function num(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

const DETAIL_HEADERS = [
  "序号",
  "发票号码",
  "开票日期",
  "销售方",
  "购买方",
  "金额",
  "税额",
  "价税合计",
  "税点",
  "类型",
  "票面备注",
  "系统备注",
  "来源文件",
];

export function buildInvoiceWorkbookBytes(invoices) {
  const wb = XLSX.utils.book_new();

  // —— 开票明细 ——
  const rows = [DETAIL_HEADERS.slice()];
  invoices.forEach((inv, i) => {
    const f = inv.fields || {};
    rows.push([
      i + 1,
      f.number || "",
      f.date || f.dateText || "",
      f.seller || "",
      f.buyer || "",
      num(f.amount),
      num(f.tax),
      num(f.total),
      f.rate || "",
      f.type || "",
      f.remark || "",
      [inv.systemNote, inv.duplicateReason].filter(Boolean).join("；"),
      inv.name || "",
    ]);
  });
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 5 }, { wch: 22 }, { wch: 12 }, { wch: 26 }, { wch: 26 },
    { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 12 },
    { wch: 22 }, { wch: 26 }, { wch: 24 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "开票明细");

  // —— 汇总账单（按销售方）——
  const bySeller = new Map();
  let tAmount = 0, tTax = 0, tTotal = 0;
  for (const inv of invoices) {
    const f = inv.fields || {};
    const seller = (f.seller || "").trim() || "(未识别销售方)";
    if (!bySeller.has(seller)) bySeller.set(seller, { count: 0, amount: 0, tax: 0, total: 0 });
    const g = bySeller.get(seller);
    g.count++;
    g.amount += Number(f.amount) || 0;
    g.tax += Number(f.tax) || 0;
    g.total += Number(f.total) || 0;
    tAmount += Number(f.amount) || 0;
    tTax += Number(f.tax) || 0;
    tTotal += Number(f.total) || 0;
  }
  const round2 = (x) => Math.round(x * 100) / 100;
  const sumRows = [["销售方", "张数", "金额合计", "税额合计", "价税合计"]];
  for (const [seller, g] of bySeller.entries()) {
    sumRows.push([seller, g.count, round2(g.amount), round2(g.tax), round2(g.total)]);
  }
  sumRows.push(["合计", invoices.length, round2(tAmount), round2(tTax), round2(tTotal)]);
  const sws = XLSX.utils.aoa_to_sheet(sumRows);
  sws["!cols"] = [{ wch: 28 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, sws, "汇总账单");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

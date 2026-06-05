// 用 SheetJS 生成“每公司一个工作表”的 Excel（含 待复核清单）。
import * as XLSX from "xlsx";
import { safeSheetName, compareDocs } from "./naming.js";

const HEADERS = ["日期", "单号", "材料名称", "单价", "数量", "总价", "单位", "备注", "来源档案"];
const COL_WIDTHS = [
  { wch: 14 },
  { wch: 16 },
  { wch: 30 },
  { wch: 10 },
  { wch: 8 },
  { wch: 10 },
  { wch: 8 },
  { wch: 28 },
  { wch: 30 },
];

function num(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

function flattenDocs(files) {
  const docs = [];
  for (const f of files) {
    const company = (f.company || "").trim() || "未命名公司";
    for (const d of f.docs || []) {
      docs.push({
        company,
        fileNote: f.note || "",
        source: d._source || "",
        date: d.date || null,
        dateText: d.dateText || d.date || "",
        orderNo: d.orderNo || "",
        items: d.items || [],
        note: d.note || "",
      });
    }
  }
  return docs;
}

function uniqueSheetName(used, base) {
  let name = base || "未命名";
  let i = 2;
  while (used.has(name)) {
    const suffix = `_${i++}`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name);
  return name;
}

// files -> xlsx 字节（ArrayBuffer）
export function buildWorkbookBytes(files) {
  const docs = flattenDocs(files);
  const byCompany = new Map();
  for (const d of docs) {
    if (!byCompany.has(d.company)) byCompany.set(d.company, []);
    byCompany.get(d.company).push(d);
  }

  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  for (const [company, ds] of byCompany.entries()) {
    const rows = [HEADERS.slice()];
    ds.sort(compareDocs);
    for (const d of ds) {
      const items = d.items.length ? d.items : [{ name: "（无明细）" }];
      for (const it of items) {
        rows.push([
          d.dateText,
          d.orderNo,
          it.name || "",
          num(it.unitPrice),
          num(it.quantity),
          num(it.total),
          it.unit || "",
          [d.fileNote, d.note, it.note].filter(Boolean).join("；"),
          d.source,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = COL_WIDTHS;
    XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName(usedNames, safeSheetName(company)));
  }

  const review = [["公司", "日期", "单号", "问题", "来源档案"]];
  for (const d of docs) {
    const problem = [d.fileNote, d.note].filter(Boolean).join("；");
    if (problem || !d.date || /待复核|裁切/.test(String(d.orderNo || ""))) {
      review.push([d.company, d.dateText, d.orderNo, problem || "待复核", d.source]);
    }
  }
  const rws = XLSX.utils.aoa_to_sheet(review);
  rws["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 16 }, { wch: 36 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, rws, uniqueSheetName(usedNames, "待复核清单"));

  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

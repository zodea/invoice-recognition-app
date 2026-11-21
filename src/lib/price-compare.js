import * as XLSX from 'xlsx/xlsx.mjs';
import { normalizeMaterial, toPrice } from './material-prices.js';
export * from './material-prices.js';

// 从历史导出的「…送货单整理汇总.xlsx」读回观测点（每工作表=一个公司；跳过待复核清单）。
export function importHistoryWorkbookItems(bytes) {
  const wb = XLSX.read(bytes, { type: "array" });
  const obs = [];
  for (const sheetName of wb.SheetNames) {
    if (/待复核/.test(sheetName)) continue;
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
    if (!grid.length) continue;
    const header = (grid[0] || []).map((h) => String(h || ""));
    const idx = (label) => header.findIndex((h) => h.includes(label));
    const ci = { date: idx("日期"), name: idx("材料"), specification: idx("规格"), price: idx("单价"), qty: idx("数量"), total: idx("总价"), unit: idx("单位") };
    if (ci.name < 0) continue;
    const supplier = sheetName.trim() || "未命名公司";
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const material = String(row[ci.name] ?? "").trim();
      if (!material || material === "（无明细）") continue;
      const name = [material, ci.specification >= 0 ? row[ci.specification] : ""].filter(Boolean).join(" ");
      const price = toPrice(ci.price >= 0 ? row[ci.price] : "", ci.total >= 0 ? row[ci.total] : "", ci.qty >= 0 ? row[ci.qty] : "");
      if (price == null) continue;
      obs.push({
        supplier,
        site: "",
        name,
        normKey: normalizeMaterial(name),
        unit: ci.unit >= 0 ? String(row[ci.unit] || "") : "",
        price,
        date: ci.date >= 0 ? String(row[ci.date] || "") : "",
      });
    }
  }
  return obs;
}

// 对比表 → Excel（行=材料，列=各供应商最近价(+区间)，末列最低价供应商）。
export function exportPriceCompareWorkbookBytes(compare) {
  const { suppliers, rows } = compare;
  const header = ["材料", "单位", ...suppliers, "最低价供应商"];
  const aoa = [header];
  for (const row of rows) {
    const cells = [row.name, row.unit];
    for (const s of suppliers) {
      const v = row.bySupplier[s];
      cells.push(v ? (v.min === v.max ? v.recent : `${v.recent}（${v.min}~${v.max}）`) : "");
    }
    cells.push(row.lowest || "");
    aoa.push(cells);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 30 }, { wch: 8 }, ...suppliers.map(() => ({ wch: 16 })), { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "单价对比");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

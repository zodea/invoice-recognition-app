// 单价对比（issue #7）：跨供应商对比同一材料的单价，辅助询价/砍价。
// 数据源：① 当前已识别的送货单明细（store.files 的 docs.items）；② 历史导出的「送货单整理汇总.xlsx」。
// 归组策略（用户已确认）：规格归一化（厘↔mm、×↔*、全/半角、去空格、大小写）后**精确匹配**自动归组；
// 拿不准的不自动并，靠**手动并组/拆组**（本地持久化）。展示：行=材料、列=供应商、单元格=最近价(+min~max)。
import * as XLSX from "xlsx";

function toHalfWidth(s) {
  return String(s || "").replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 规格归一化 → 归组主键。保守：只统一明确等价的写法，不做语义猜测。
export function normalizeMaterial(name) {
  let s = toHalfWidth(String(name || "")).toLowerCase();
  s = s.replace(/[\s　]/g, ""); // 去空格（含全角）
  s = s.replace(/厘米?/g, "mm"); // 9厘 / 9厘米 → 9mm（板材厚度俗写）
  s = s.replace(/[×✕╳]/g, "*"); // 乘号统一为 *
  s = s.replace(/(\d)\s*x\s*(\d)/g, "$1*$2"); // 8x6 → 8*6（仅数字间的 x）
  return s.trim();
}

function toPrice(unitPrice, total, quantity) {
  let p = Number(unitPrice);
  if (Number.isFinite(p) && p > 0) return Math.round(p * 100) / 100;
  const t = Number(total);
  const q = Number(quantity);
  if (Number.isFinite(t) && Number.isFinite(q) && q > 0) return Math.round((t / q) * 100) / 100;
  return null;
}

// store.files + partitions → 观测点数组 [{ supplier, site, name, normKey, unit, price, date }]
export function aggregateItems(files, partitions) {
  const siteById = new Map((partitions || []).map((p) => [p.id, p.name]));
  const obs = [];
  for (const f of files || []) {
    const supplier = (f.company || "").trim() || "未命名公司";
    const site = siteById.get(f.partitionId) || "";
    for (const d of f.docs || []) {
      const date = d.date || d.dateText || "";
      for (const it of d.items || []) {
        const name = String(it.name || "").trim();
        if (!name) continue;
        const price = toPrice(it.unitPrice, it.total, it.quantity);
        if (price == null) continue; // 无单价不参与对比
        obs.push({ supplier, site, name, normKey: normalizeMaterial(name), unit: it.unit || "", price, date: String(date || "") });
      }
    }
  }
  return obs;
}

// 观测点 → 对比表 { suppliers:[名], rows:[{ key, name, names[], unit, bySupplier{ 供应商:{recent,min,max,count} }, lowest }] }
// manualGroups: { normKey: 组主键 }（手动并组的映射）；site: 仅统计该工地（空=跨工地汇总）。
export function buildPriceCompare(obs, { manualGroups = {}, site = "" } = {}) {
  const rows = new Map();
  const supplierSet = new Set();
  for (const o of obs) {
    if (site && o.site !== site) continue;
    const key = manualGroups[o.normKey] || o.normKey;
    supplierSet.add(o.supplier);
    let row = rows.get(key);
    if (!row) { row = { key, names: new Map(), units: new Set(), suppliers: new Map() }; rows.set(key, row); }
    row.names.set(o.name, (row.names.get(o.name) || 0) + 1);
    if (o.unit) row.units.add(o.unit);
    let sup = row.suppliers.get(o.supplier);
    if (!sup) { sup = []; row.suppliers.set(o.supplier, sup); }
    sup.push({ price: o.price, date: o.date });
  }
  const suppliers = [...supplierSet].sort((a, b) => a.localeCompare(b, "zh"));
  const outRows = [...rows.values()]
    .map((row) => {
      const name = [...row.names.entries()].sort((a, b) => b[1] - a[1])[0][0]; // 最常见的原始写法做显示名
      const bySupplier = {};
      let lowest = null;
      let lowestPrice = Infinity;
      for (const [sname, list] of row.suppliers.entries()) {
        const prices = list.map((p) => p.price);
        const dated = list.filter((p) => p.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const recent = dated.length ? dated[dated.length - 1].price : list[list.length - 1].price;
        bySupplier[sname] = { recent, min: Math.min(...prices), max: Math.max(...prices), count: list.length };
        if (recent < lowestPrice) { lowestPrice = recent; lowest = sname; }
      }
      return { key: row.key, name, names: [...row.names.keys()], unit: [...row.units].join("/"), bySupplier, lowest };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
  return { suppliers, rows: outRows };
}

// —— 手动并组/拆组（纯函数，返回新映射） ——
// 并组：把 memberKeys 都指向 targetKey（含已指向 member 的也改指 target）。
export function mergeGroups(manualGroups, targetKey, memberKeys) {
  const m = { ...manualGroups };
  const members = new Set(memberKeys.filter((k) => k !== targetKey));
  for (const k of members) m[k] = targetKey;
  for (const k of Object.keys(m)) if (members.has(m[k])) m[k] = targetKey;
  if (m[targetKey] === targetKey) delete m[targetKey];
  return m;
}
// 拆组：解除该 key 的并组（它自己 + 指向它的都恢复独立）。
export function splitGroup(manualGroups, key) {
  const m = { ...manualGroups };
  delete m[key];
  for (const k of Object.keys(m)) if (m[k] === key) delete m[k];
  return m;
}

const LS_KEY = "priceCompareManualGroups";
export function loadManualGroups() {
  try { return JSON.parse((typeof localStorage !== "undefined" && localStorage.getItem(LS_KEY)) || "{}"); } catch { return {}; }
}
export function saveManualGroups(m) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, JSON.stringify(m || {})); } catch { /* ignore */ }
}

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
    const ci = { date: idx("日期"), name: idx("材料"), price: idx("单价"), qty: idx("数量"), total: idx("总价"), unit: idx("单位") };
    if (ci.name < 0) continue;
    const supplier = sheetName.trim() || "未命名公司";
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (!row) continue;
      const name = String(row[ci.name] ?? "").trim();
      if (!name || name === "（无明细）") continue;
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

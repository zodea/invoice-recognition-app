// 施工项目资料库（DESIGN-project-worker.md §一）：为现有"工地/分区"（识别明细库的 site key）
// 补充结构化元数据——工期/状态/参建各方/管理人员。本地持久化（localStorage，沿用分供方模式）。
// 名称归一化复用 supplier-db（让项目名能模糊命中识别明细库的 site）。
import * as XLSX from "xlsx";
import { normalizeCompanyName, coreCompanyName } from "./supplier-db";

const STORAGE_KEY = "projectDb.v1";

let seq = 0;
const uid = () => `proj_${Date.now().toString(36)}_${(seq++).toString(36)}`;

// Node 自测环境没有 localStorage，用内存兜底。
const mem = { v: "" };
function storageGet() {
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(STORAGE_KEY) || "";
  } catch (e) { /* ignore */ }
  return mem.v;
}
function storageSet(v) {
  try {
    if (typeof localStorage !== "undefined") { localStorage.setItem(STORAGE_KEY, v); return; }
  } catch (e) { /* ignore */ }
  mem.v = v;
}

export const PROJECT_TYPES = ["住宅", "商业", "市政", "工业", "装修", "其他"];
export const PROJECT_STATUS = ["筹备中", "施工中", "停工", "已竣工", "已结算"];

// 状态 → chip 变体（uno shortcut）。筹备中=黄、施工中=蓝、停工=灰、已竣工/已结算=绿。
export function projectStatusChip(status) {
  switch (status) {
    case "施工中": return "chip-brand";
    case "已竣工":
    case "已结算": return "chip-ok";
    case "停工": return "chip bg-surface-3 text-ink-soft";
    case "筹备中":
    default: return "chip-warn";
  }
}

export function emptyProject() {
  return {
    id: uid(),
    name: "",          // 项目名称（必填，≥2字）——对应现有"工地/分区"名
    code: "",          // 项目编号
    address: "",       // 施工现场地址
    type: "",          // 项目类型
    area: null,        // 建筑面积 m²
    contractAmount: null, // 合同金额（万元）

    startDate: "",     // 开工日期
    plannedEnd: "",    // 计划竣工日期
    actualEnd: "",     // 实际竣工日期
    status: "筹备中",  // 当前状态

    developer: "",     // 建设单位（甲方/业主）
    supervisor: "",    // 监理单位
    designer: "",      // 设计单位
    contractor: "",    // 总包单位

    manager: "",       // 项目经理
    managerPhone: "",  // 项目经理电话
    siteLeader: "",    // 现场负责人
    siteLeaderPhone: "", // 现场负责人电话

    note: "",
    source: "manual",  // manual | import
  };
}

export function loadProjects() {
  try {
    const raw = storageGet();
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((p) => p && p.name) : [];
  } catch (e) {
    return [];
  }
}

export function saveProjects(list) {
  storageSet(JSON.stringify(list || []));
}

// 项目名 ↔ 识别明细库 site 的模糊匹配（与 matchSupplier 同思路：归一化精确 > 核心名互含）。
// 返回 true/false——用于「该 site 是否属于此项目」。
export function projectMatchesSite(project, site) {
  const a = normalizeCompanyName(project?.name);
  const b = normalizeCompanyName(site);
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = coreCompanyName(project?.name);
  const cb = coreCompanyName(site);
  if (ca.length >= 2 && cb.length >= 2) return ca.includes(cb) || cb.includes(ca);
  return false;
}

// —— Excel 导入/导出 ——
const EXPORT_HEADERS = [
  "项目名称", "项目编号", "项目类型", "项目地址", "建筑面积", "合同金额",
  "开工日期", "计划竣工", "实际竣工", "状态",
  "建设单位", "监理单位", "设计单位", "总包单位",
  "项目经理", "项目经理电话", "现场负责人", "现场负责人电话", "备注",
];

export function exportProjectsWorkbookBytes(list) {
  const rows = [EXPORT_HEADERS.slice()];
  for (const p of list) {
    rows.push([
      p.name, p.code, p.type, p.address, p.area ?? "", p.contractAmount ?? "",
      p.startDate, p.plannedEnd, p.actualEnd, p.status,
      p.developer, p.supervisor, p.designer, p.contractor,
      p.manager, p.managerPhone, p.siteLeader, p.siteLeaderPhone, p.note,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = EXPORT_HEADERS.map((h) => ({ wch: /地址|单位/.test(h) ? 24 : /名称/.test(h) ? 28 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "施工项目");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function headerIndex(headers, keys) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").replace(/\s/g, "");
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

// 按项目名称去重导入（撞名补空字段，不覆盖已填）。
export function importProjectsWorkbookBytes(list, bytes) {
  const wb = XLSX.read(bytes, { type: "array" });
  let imported = 0, added = 0, updated = 0;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (!rows.length) continue;
    const head = rows[0].map(String);
    const iName = headerIndex(head, ["项目名称", "工程名称", "项目", "工地", "名称"]);
    if (iName < 0) continue;
    const idx = {
      code: headerIndex(head, ["项目编号", "编号"]),
      type: headerIndex(head, ["项目类型", "类型"]),
      address: headerIndex(head, ["项目地址", "地址", "现场"]),
      area: headerIndex(head, ["建筑面积", "面积"]),
      contractAmount: headerIndex(head, ["合同金额", "合同额", "金额"]),
      startDate: headerIndex(head, ["开工日期", "开工"]),
      plannedEnd: headerIndex(head, ["计划竣工", "计划完工"]),
      actualEnd: headerIndex(head, ["实际竣工", "实际完工"]),
      status: headerIndex(head, ["状态"]),
      developer: headerIndex(head, ["建设单位", "甲方", "业主"]),
      supervisor: headerIndex(head, ["监理单位", "监理"]),
      designer: headerIndex(head, ["设计单位", "设计"]),
      contractor: headerIndex(head, ["总包单位", "总包", "施工单位"]),
      manager: headerIndex(head, ["项目经理"]),
      managerPhone: headerIndex(head, ["项目经理电话"]),
      siteLeader: headerIndex(head, ["现场负责人"]),
      siteLeaderPhone: headerIndex(head, ["现场负责人电话"]),
      note: headerIndex(head, ["备注"]),
    };
    const cell = (r, i) => (i >= 0 ? String(r[i] || "").trim() : "");
    const num = (r, i) => { const v = cell(r, i); return v === "" ? null : (Number(v) || null); };
    for (const r of rows.slice(1)) {
      const name = cell(r, iName);
      if (!name || name.length < 2) continue;
      imported++;
      const patch = {
        code: cell(r, idx.code), type: cell(r, idx.type), address: cell(r, idx.address),
        area: num(r, idx.area), contractAmount: num(r, idx.contractAmount),
        startDate: cell(r, idx.startDate), plannedEnd: cell(r, idx.plannedEnd), actualEnd: cell(r, idx.actualEnd),
        status: cell(r, idx.status), developer: cell(r, idx.developer), supervisor: cell(r, idx.supervisor),
        designer: cell(r, idx.designer), contractor: cell(r, idx.contractor),
        manager: cell(r, idx.manager), managerPhone: cell(r, idx.managerPhone),
        siteLeader: cell(r, idx.siteLeader), siteLeaderPhone: cell(r, idx.siteLeaderPhone), note: cell(r, idx.note),
      };
      const exist = list.find((p) => normalizeCompanyName(p.name) === normalizeCompanyName(name));
      if (!exist) {
        const p = emptyProject();
        p.name = name;
        for (const k of Object.keys(patch)) if (patch[k] != null && patch[k] !== "") p[k] = patch[k];
        if (!PROJECT_STATUS.includes(p.status)) p.status = "筹备中";
        p.source = "import";
        list.push(p);
        added++;
      } else {
        let touched = false;
        for (const k of Object.keys(patch)) {
          if ((patch[k] != null && patch[k] !== "") && (exist[k] == null || exist[k] === "")) { exist[k] = patch[k]; touched = true; }
        }
        if (touched) updated++;
      }
    }
    break;
  }
  return { imported, added, updated };
}

// 工人信息库（DESIGN-project-worker.md §二）：自然人档案——身份证/工种/技能/班组/项目分配 + 证书档案（带有效期）。
// 本地持久化（localStorage，沿用分供方模式）。证书有效期追踪供列表汇总卡片与详情着色用。
import * as XLSX from "xlsx";
import { normalizeCompanyName } from "./supplier-db";

const STORAGE_KEY = "workerDb.v1";

let seq = 0;
const uid = () => `wkr_${Date.now().toString(36)}_${(seq++).toString(36)}`;
export const certUid = () => `cert_${Date.now().toString(36)}_${(seq++).toString(36)}`;

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

export const TRADES = ["木工", "泥工", "钢筋工", "电工", "焊工", "架子工", "油漆工", "防水工", "水暖工", "测量工", "普工", "机械操作工", "其他"];
export const SKILL_LEVELS = ["初级", "中级", "高级", "技师"];
export const PROJECT_STATUS = ["在场", "已退场"];
export const CERT_CATEGORIES = ["身份证", "安全培训合格证", "特种作业操作证", "其他"];

export function emptyWorker() {
  return {
    id: uid(),
    name: "",            // 姓名（必填，≥2字）
    gender: "",          // 男 | 女
    idCard: "",          // 身份证号（18位）
    phone: "",           // 联系电话（必填）
    hometown: "",        // 籍贯
    emergencyContact: "", // 紧急联系人
    emergencyPhone: "",   // 紧急联系电话

    trade: "",           // 工种（必填）
    skillLevel: "",      // 技能等级
    dailyWage: null,     // 日工资（元）
    team: "",            // 所属班组

    currentProject: "",  // 当前项目名称（关联施工项目）
    projectStatus: "在场", // 在场 | 已退场
    entryDate: "",       // 进场日期
    exitDate: "",        // 退场日期

    certs: [],           // 证书档案 [{id,category,subType,fileName,relPath,ext,expiryDate,addedAt}]
    attendance: [],      // 出勤记录 [{id,month,daysWorked,note}]
    payments: [],        // 工资支付记录 [{id,date,amount,method,note}]

    note: "",
    source: "manual",    // manual | import
  };
}

export function emptyCert() {
  return { id: certUid(), category: "身份证", subType: "", fileName: "", relPath: "", ext: "", expiryDate: "", addedAt: "" };
}
export function emptyAttendance() {
  return { id: certUid(), month: "", daysWorked: "", note: "" };
}
export function emptyWorkerPayment() {
  return { id: certUid(), date: "", amount: "", method: "", note: "" };
}

export function loadWorkers() {
  try {
    const raw = storageGet();
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((w) => w && w.name) : [];
  } catch (e) {
    return [];
  }
}
export function saveWorkers(list) {
  storageSet(JSON.stringify(list || []));
}

// —— 证书有效期状态 —— 返回 expired | soon | valid | none。soon = days 天内到期（默认 30）。
export function certExpiryStatus(expiryDate, days = 30) {
  const d = String(expiryDate || "").trim();
  if (!d) return "none";
  const t = new Date(d + "T00:00:00").getTime();
  if (!Number.isFinite(t)) return "none";
  const now = Date.now();
  if (t < now) return "expired";
  if (t - now <= days * 86400000) return "soon";
  return "valid";
}
// 证书状态 → uno class（红/橙/绿/灰）。
export function certStatusClass(status) {
  switch (status) {
    case "expired": return "chip-danger";
    case "soon": return "chip-warn";
    case "valid": return "chip-ok";
    default: return "chip bg-surface-3 text-ink-soft";
  }
}
export function certStatusLabel(status) {
  return { expired: "已过期", soon: "即将到期", valid: "有效", none: "无有效期" }[status] || "—";
}

// —— Excel 导入/导出（不含证书档案，证书走附件落盘）——
const EXPORT_HEADERS = [
  "姓名", "性别", "身份证号", "联系电话", "籍贯", "紧急联系人", "紧急联系电话",
  "工种", "技能等级", "日工资", "所属班组", "当前项目", "在场状态", "进场日期", "退场日期", "备注",
];

export function exportWorkersWorkbookBytes(list) {
  const rows = [EXPORT_HEADERS.slice()];
  for (const w of list) {
    rows.push([
      w.name, w.gender, w.idCard, w.phone, w.hometown, w.emergencyContact, w.emergencyPhone,
      w.trade, w.skillLevel, w.dailyWage ?? "", w.team, w.currentProject, w.projectStatus, w.entryDate, w.exitDate, w.note,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = EXPORT_HEADERS.map((h) => ({ wch: /身份证|项目/.test(h) ? 22 : /联系|籍贯|备注/.test(h) ? 16 : 10 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "工人信息");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

function headerIndex(headers, keys) {
  for (let i = 0; i < headers.length; i++) {
    const h = String(headers[i] || "").replace(/\s/g, "");
    if (keys.some((k) => h.includes(k))) return i;
  }
  return -1;
}

// 按 姓名+身份证号 去重导入。
export function importWorkersWorkbookBytes(list, bytes) {
  const wb = XLSX.read(bytes, { type: "array" });
  let imported = 0, added = 0, updated = 0;
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
    if (!rows.length) continue;
    const head = rows[0].map(String);
    const iName = headerIndex(head, ["姓名", "名字", "工人", "人员"]);
    if (iName < 0) continue;
    const idx = {
      gender: headerIndex(head, ["性别"]),
      idCard: headerIndex(head, ["身份证"]),
      phone: headerIndex(head, ["联系电话", "电话", "手机"]),
      hometown: headerIndex(head, ["籍贯", "户籍"]),
      emergencyContact: headerIndex(head, ["紧急联系人"]),
      emergencyPhone: headerIndex(head, ["紧急联系电话", "紧急电话"]),
      trade: headerIndex(head, ["工种"]),
      skillLevel: headerIndex(head, ["技能等级", "等级"]),
      dailyWage: headerIndex(head, ["日工资", "工资"]),
      team: headerIndex(head, ["班组", "队组"]),
      currentProject: headerIndex(head, ["当前项目", "项目", "工地"]),
      projectStatus: headerIndex(head, ["在场状态", "状态"]),
      entryDate: headerIndex(head, ["进场日期", "进场"]),
      exitDate: headerIndex(head, ["退场日期", "退场"]),
      note: headerIndex(head, ["备注"]),
    };
    const cell = (r, i) => (i >= 0 ? String(r[i] || "").trim() : "");
    const num = (r, i) => { const v = cell(r, i); return v === "" ? null : (Number(v) || null); };
    const key = (name, id) => normalizeCompanyName(name) + "|" + String(id || "").replace(/\s/g, "");
    for (const r of rows.slice(1)) {
      const name = cell(r, iName);
      if (!name || name.length < 2) continue;
      imported++;
      const idCard = cell(r, idx.idCard);
      const patch = {
        gender: cell(r, idx.gender), idCard, phone: cell(r, idx.phone), hometown: cell(r, idx.hometown),
        emergencyContact: cell(r, idx.emergencyContact), emergencyPhone: cell(r, idx.emergencyPhone),
        trade: cell(r, idx.trade), skillLevel: cell(r, idx.skillLevel), dailyWage: num(r, idx.dailyWage),
        team: cell(r, idx.team), currentProject: cell(r, idx.currentProject), projectStatus: cell(r, idx.projectStatus),
        entryDate: cell(r, idx.entryDate), exitDate: cell(r, idx.exitDate), note: cell(r, idx.note),
      };
      const exist = list.find((w) => key(w.name, w.idCard) === key(name, idCard));
      if (!exist) {
        const w = emptyWorker();
        w.name = name;
        for (const k of Object.keys(patch)) if (patch[k] != null && patch[k] !== "") w[k] = patch[k];
        if (!PROJECT_STATUS.includes(w.projectStatus)) w.projectStatus = "在场";
        w.source = "import";
        list.push(w);
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

const ILLEGAL_FILE_CHARS = /[\x00-\x1f\\/:*?"<>|]/g;

function valueOrFallback(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

export function sanitizeFilePart(value, fallback = "未识别") {
  return valueOrFallback(value, fallback)
    .replace(/:/g, "：")
    .replace(/\//g, "／")
    .replace(/\\/g, "＼")
    .replace(/\*/g, "＊")
    .replace(/\?/g, "？")
    .replace(/"/g, "＂")
    .replace(/</g, "＜")
    .replace(/>/g, "＞")
    .replace(/\|/g, "｜")
    .replace(ILLEGAL_FILE_CHARS, "")
    .replace(/\s+/g, "")
    .replace(/\.+$/, "")
    .slice(0, 120)
    .trim() || fallback;
}

function moneyText(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function invoiceExtension(inv) {
  const name = inv?.name || "";
  const ext = (name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
  if (ext) return ext;
  const type = inv?.blob?.type || "";
  if (type.includes("png")) return ".png";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  if (type.includes("webp")) return ".webp";
  return ".pdf";
}

export function invoiceExportFileName(inv) {
  const fields = inv?.fields || {};
  const seller = sanitizeFilePart(fields.seller, "未识别销售方");
  const date = sanitizeFilePart(fields.date || fields.dateText, "无日期");
  const total = moneyText(fields.total);
  return `${seller}：${date}=${total}元${invoiceExtension(inv)}`;
}

function dateRange(invoices) {
  const dates = invoices
    .map((inv) => inv?.fields?.date || inv?.fields?.dateText || "")
    .filter(Boolean)
    .sort();
  return dates.length ? [dates[0], dates[dates.length - 1]] : [];
}

export function exportWorkbookName(invoices) {
  const r = dateRange(invoices);
  if (!r.length) return "发票统计.xlsx";
  return `发票统计_${r[0]}至${r[1]}.xlsx`;
}

// 待优化#2：把整批导出物收进一个父文件夹，按开票日期区间命名
export function exportParentFolderName(invoices) {
  const r = dateRange(invoices);
  if (!r.length) return "发票整理";
  return `发票整理_${r[0]}至${r[1]}`;
}

// 待优化#3：分目录维度。专票/普票从 type 推断，行程单/货运凭证用 docType。
function invoiceTypePart(inv) {
  const f = inv?.fields || {};
  if (f.taxKind) return f.taxKind; // 专用发票 / 普通发票（最可靠，来自票面括注/全称）
  const t = String(f.type || "");
  const d = String(f.docType || "");
  if (/专用/.test(t)) return "专用发票";
  if (/普通/.test(t)) return "普通发票";
  if (d && d !== "增值税发票") return d; // 行程单 / 货物运输凭证
  return t || d || "";
}
const DIMENSION_PART = {
  buyer: (inv) => sanitizeFilePart(inv?.fields?.buyer, "未识别购买方"),
  seller: (inv) => sanitizeFilePart(inv?.fields?.seller, "未识别销售方"),
  date: (inv) => sanitizeFilePart(inv?.fields?.date || inv?.fields?.dateText, "无日期"),
  type: (inv) => sanitizeFilePart(invoiceTypePart(inv), "未识别类型"),
};
// 供 UI 选择的维度清单（顺序即默认展示顺序；实际嵌套顺序由用户勾选先后决定）
export const GROUP_DIMENSIONS = [
  { key: "buyer", label: "购买方" },
  { key: "seller", label: "销售方" },
  { key: "date", label: "日期" },
  { key: "type", label: "发票类型(专票/普票)" },
];

// 按所选维度(保持传入顺序)返回该发票的嵌套文件夹路径数组
export function invoiceFolderParts(inv, dims = []) {
  const parts = [];
  for (const key of dims) {
    const fn = DIMENSION_PART[key];
    if (fn) parts.push(fn(inv));
  }
  return parts;
}

async function exists(directoryHandle, name) {
  try {
    await directoryHandle.getFileHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

async function uniqueFileName(directoryHandle, preferredName) {
  if (!(await exists(directoryHandle, preferredName))) return preferredName;
  const ext = preferredName.match(/\.[^.]+$/)?.[0] || "";
  const stem = ext ? preferredName.slice(0, -ext.length) : preferredName;
  let i = 2;
  while (await exists(directoryHandle, `${stem}(${i})${ext}`)) i++;
  return `${stem}(${i})${ext}`;
}

async function writeBytes(directoryHandle, name, bytes) {
  const safeName = await uniqueFileName(directoryHandle, name);
  const fileHandle = await directoryHandle.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
  return safeName;
}

// 兼容旧的 groupByBuyer 布尔：没传 dims 时，true 等价于按购买方分目录
function normalizeDims({ dims, groupByBuyer }) {
  if (Array.isArray(dims) && dims.length) return dims;
  return groupByBuyer ? ["buyer"] : [];
}

// 依次进入/创建多级子目录（File System Access API）
async function resolveDir(rootHandle, parts) {
  let dir = rootHandle;
  for (const p of parts) {
    if (!p) continue;
    dir = await dir.getDirectoryHandle(p, { create: true });
  }
  return dir;
}

export async function writeInvoiceExportPackage(invoices, rootHandle, { excelBytes, dims, groupByBuyer = false } = {}) {
  if (!rootHandle || typeof rootHandle.getFileHandle !== "function") {
    throw new Error("当前环境不支持目录写入。");
  }

  const useDims = normalizeDims({ dims, groupByBuyer });
  const parent = exportParentFolderName(invoices);
  const parentDir = await resolveDir(rootHandle, [parent]); // 待优化#2：统一收进父文件夹
  const result = { excelName: "", fileCount: 0, parent, dims: useDims };

  if (excelBytes) {
    result.excelName = await writeBytes(parentDir, exportWorkbookName(invoices), excelBytes);
  }

  for (const inv of invoices) {
    if (!inv?.blob) continue;
    const dir = await resolveDir(parentDir, invoiceFolderParts(inv, useDims)); // 待优化#3：按维度嵌套
    const name = await uniqueFileName(dir, invoiceExportFileName(inv));
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(inv.blob);
    await writable.close();
    result.fileCount++;
  }

  return result;
}

export function canUseTauriExport() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export function canChooseSaveDir() {
  return canUseTauriExport() || (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function");
}

// 让用户选目录后把单个文件（PDF / Excel）写进去，与“整理导出”一致的保存体验。
// 返回 { saved } / { canceled } / { fallbackDownload }（调用方在不支持选目录时回退浏览器下载）。
export async function saveBytesToChosenDir(bytes, fileName) {
  if (canUseTauriExport()) {
    const dir = await pickTauriExportDir();
    if (!dir) return { canceled: true };
    const saved = await writeTauriFile(dir, [], fileName, bytes);
    return { saved };
  }
  if (typeof window !== "undefined" && typeof window.showDirectoryPicker === "function") {
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    const saved = await writeBytes(dir, fileName, bytes);
    return { saved };
  }
  return { fallbackDownload: true };
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return new Uint8Array(bytes || []);
}

function bytesToBase64(bytes) {
  const u8 = toUint8Array(bytes);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function invokeTauri(command, args) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(command, args);
}

async function writeTauriFile(root, parts, fileName, bytes) {
  return invokeTauri("write_export_file", {
    root,
    parts,
    fileName,
    dataBase64: bytesToBase64(bytes),
  });
}

export async function pickTauriExportDir() {
  return invokeTauri("pick_export_dir");
}

export async function writeInvoiceExportPackageTauri(invoices, root, { excelBytes, dims, groupByBuyer = false } = {}) {
  if (!root) throw new Error("未选择保存目录。");

  const useDims = normalizeDims({ dims, groupByBuyer });
  const parent = exportParentFolderName(invoices); // 待优化#2：父文件夹
  const result = { excelName: "", fileCount: 0, parent, dims: useDims };

  if (excelBytes) {
    result.excelName = await writeTauriFile(root, [parent], exportWorkbookName(invoices), excelBytes);
  }

  for (const inv of invoices) {
    if (!inv?.blob) continue;
    const parts = [parent, ...invoiceFolderParts(inv, useDims)]; // 待优化#3：父/维度1/维度2…
    const bytes = await inv.blob.arrayBuffer();
    await writeTauriFile(root, parts, invoiceExportFileName(inv), bytes);
    result.fileCount++;
  }

  return result;
}

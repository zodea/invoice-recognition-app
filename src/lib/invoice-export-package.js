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

export function exportWorkbookName(invoices) {
  const dates = invoices
    .map((inv) => inv?.fields?.date || inv?.fields?.dateText || "")
    .filter(Boolean)
    .sort();
  if (!dates.length) return "发票统计.xlsx";
  return `发票统计_${dates[0]}至${dates[dates.length - 1]}.xlsx`;
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

async function targetDirectory(rootHandle, inv, groupByBuyer) {
  if (!groupByBuyer) return rootHandle;
  const buyer = sanitizeFilePart(inv?.fields?.buyer, "未识别购买方");
  return rootHandle.getDirectoryHandle(buyer, { create: true });
}

export async function writeInvoiceExportPackage(invoices, rootHandle, { excelBytes, groupByBuyer = false } = {}) {
  if (!rootHandle || typeof rootHandle.getFileHandle !== "function") {
    throw new Error("当前环境不支持目录写入。");
  }

  const result = {
    excelName: "",
    fileCount: 0,
    grouped: groupByBuyer,
  };

  if (excelBytes) {
    result.excelName = await writeBytes(rootHandle, exportWorkbookName(invoices), excelBytes);
  }

  for (const inv of invoices) {
    if (!inv?.blob) continue;
    const dir = await targetDirectory(rootHandle, inv, groupByBuyer);
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

export async function writeInvoiceExportPackageTauri(invoices, root, { excelBytes, groupByBuyer = false } = {}) {
  if (!root) throw new Error("未选择保存目录。");

  const result = {
    excelName: "",
    fileCount: 0,
    grouped: groupByBuyer,
  };

  if (excelBytes) {
    result.excelName = await writeTauriFile(root, [], exportWorkbookName(invoices), excelBytes);
  }

  for (const inv of invoices) {
    if (!inv?.blob) continue;
    const parts = groupByBuyer ? [sanitizeFilePart(inv?.fields?.buyer, "未识别购买方")] : [];
    const bytes = await inv.blob.arrayBuffer();
    await writeTauriFile(root, parts, invoiceExportFileName(inv), bytes);
    result.fileCount++;
  }

  return result;
}

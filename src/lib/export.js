// 导出编排（CONTEXT「公司文件夹」）：选文件夹 → 工地目录 → 每公司一个子文件夹 →
// 合并 PDF（公司-日期范围-送货单N张.pdf）或单件（日期-原名.pdf）；
// 工地根目录放「工地名-送货单整理汇总.xlsx」。
import { buildPdfFromFiles } from "./pdf.js";
import { buildWorkbookBytes } from "./excel.js";
import { archiveBaseName, sanitize } from "./naming.js";

export function fsAccessSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

async function writeFileUnique(dirHandle, name, bytes, used) {
  let finalName = name;
  if (used) {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    let i = 2;
    while (used.has(finalName)) finalName = `${stem}(${i++})${ext}`;
    used.add(finalName);
  }
  const fh = await dirHandle.getFileHandle(finalName, { create: true });
  const w = await fh.createWritable();
  await w.write(bytes);
  await w.close();
  return finalName;
}

// 把一个公司的文件分组：merge=true 的合成一份，其余各自一份。
function groupForExport(companyFiles) {
  const merged = companyFiles.filter((f) => f.merge);
  const solo = companyFiles.filter((f) => !f.merge);
  const groups = [];
  if (merged.length) groups.push(merged);
  for (const f of solo) groups.push([f]);
  return groups;
}

function groupByCompany(files) {
  const map = new Map();
  for (const f of files) {
    const c = (f.company || "").trim() || "未命名公司";
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(f);
  }
  return map;
}

// 单件（不合并）的命名：日期-原文件名.pdf；没有日期用"日期待复核"。
function soloPdfName(f) {
  const date = (f.docs && f.docs[0] && f.docs[0].date) || "日期待复核";
  const stem = String(f.name || "文件").replace(/\.[^.]+$/, "");
  return sanitize(`${date}-${stem}`) + ".pdf";
}

// 先生成 PDF（并回填每张单的来源档案名），再用回填后的数据生成 Excel。
// writeIn(companyDirName, fileName, bytes) 由调用方决定写到 公司子文件夹（FS Access）
// 还是加前缀下载（回退）。来源档案记成 "公司/文件名" 方便在 Excel 里定位。
async function exportPartitionPdfs(files, writeIn, log) {
  const byCompany = groupByCompany(files);
  for (const [company, cfiles] of byCompany.entries()) {
    const companyDir = sanitize(company) || "未命名公司";
    for (const group of groupForExport(cfiles)) {
      const docs = group.flatMap((f) => f.docs || []);
      const merged = group.length > 1 || (group.length === 1 && group[0].merge);
      const count = docs.length || group.length;
      const base = merged
        ? `${archiveBaseName(company, docs.map((d) => d.date), count)}.pdf`
        : soloPdfName(group[0]);
      const bytes = await buildPdfFromFiles(group);
      const finalName = await writeIn(companyDir, base, bytes);
      for (const f of group) for (const d of f.docs || []) d._source = `${companyDir}/${finalName}`;
      if (log) log(`  ${companyDir}/${finalName}（${count} 张）`);
    }
  }
}

// 主入口：File System Access API 版本
export async function exportToDirectory({ partitions, files }, log) {
  const root = await window.showDirectoryPicker({ mode: "readwrite" });
  let total = 0;
  for (const part of partitions) {
    const pfiles = files.filter((f) => f.partitionId === part.id);
    if (!pfiles.length) continue;
    const dirName = sanitize(part.name) || "未命名工地";
    if (log) log(`工地【${part.name}】→ ${dirName}/`);
    const dir = await root.getDirectoryHandle(dirName, { create: true });

    const usedPerCompany = new Map(); // 公司目录内各自防重名
    await exportPartitionPdfs(
      pfiles,
      async (companyDir, name, bytes) => {
        const cdir = await dir.getDirectoryHandle(companyDir, { create: true });
        if (!usedPerCompany.has(companyDir)) usedPerCompany.set(companyDir, new Set());
        return await writeFileUnique(cdir, name, bytes, usedPerCompany.get(companyDir));
      },
      log
    );

    const xlsx = buildWorkbookBytes(pfiles);
    const xlsxName = `${sanitize(part.name) || "工地"}-送货单整理汇总.xlsx`;
    await writeFileUnique(dir, xlsxName, xlsx);
    if (log) log(`  Excel：${xlsxName}`);
    total += pfiles.length;
  }
  return { ok: true, files: total };
}

// 回退方案（Firefox 等不支持目录选择）：逐个触发下载，文件名带分区前缀。
function downloadBlob(name, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportByDownload({ partitions, files }, log) {
  let total = 0;
  for (const part of partitions) {
    const pfiles = files.filter((f) => f.partitionId === part.id);
    if (!pfiles.length) continue;
    const prefix = `${sanitize(part.name) || "未命名工地"}__`;
    if (log) log(`工地【${part.name}】（下载方式）`);
    const used = new Set();
    await exportPartitionPdfs(
      pfiles,
      async (companyDir, name, bytes) => {
        let finalName = name;
        let i = 2;
        while (used.has(`${companyDir}/${finalName}`)) {
          const dot = name.lastIndexOf(".");
          finalName = `${name.slice(0, dot)}(${i++})${name.slice(dot)}`;
        }
        used.add(`${companyDir}/${finalName}`);
        downloadBlob(`${prefix}${companyDir}__${finalName}`, bytes, "application/pdf");
        if (log) log(`  下载：${prefix}${companyDir}__${finalName}`);
        return finalName;
      },
      null
    );
    const xlsx = buildWorkbookBytes(pfiles);
    downloadBlob(`${prefix}${sanitize(part.name) || "工地"}-送货单整理汇总.xlsx`, xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    total += pfiles.length;
  }
  return { ok: true, files: total, mode: "download" };
}

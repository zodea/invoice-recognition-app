// 导出编排：选文件夹 -> 每个分区一个子目录 -> 按公司-日期命名的 PDF + 汇总 Excel。
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

// 先生成 PDF（并回填每张单的来源档案名），再用回填后的数据生成 Excel。
async function exportPartitionPdfs(files, writeFn, log) {
  const usedNames = new Set();
  const byCompany = groupByCompany(files);
  for (const [company, cfiles] of byCompany.entries()) {
    for (const group of groupForExport(cfiles)) {
      const docs = group.flatMap((f) => f.docs || []);
      const dates = docs.map((d) => d.date);
      const count = docs.length || group.length;
      const base = archiveBaseName(company, dates, count);
      const bytes = await buildPdfFromFiles(group);
      const finalName = await writeFn(`${base}.pdf`, bytes, usedNames);
      for (const f of group) for (const d of f.docs || []) d._source = finalName;
      if (log) log(`  PDF：${finalName}（${count} 张）`);
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
    const dirName = sanitize(part.name) || "未命名分区";
    if (log) log(`分区【${part.name}】→ ${dirName}/`);
    const dir = await root.getDirectoryHandle(dirName, { create: true });

    await exportPartitionPdfs(pfiles, (name, bytes, used) => writeFileUnique(dir, name, bytes, used), log);

    const xlsx = buildWorkbookBytes(pfiles);
    await writeFileUnique(dir, "送货单整理汇总.xlsx", xlsx);
    if (log) log(`  Excel：送货单整理汇总.xlsx`);
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
    const prefix = `${sanitize(part.name) || "未命名分区"}__`;
    if (log) log(`分区【${part.name}】（下载方式）`);
    const used = new Set();
    await exportPartitionPdfs(
      pfiles,
      async (name, bytes, u) => {
        let finalName = name;
        let i = 2;
        while (used.has(finalName)) {
          const dot = name.lastIndexOf(".");
          finalName = `${name.slice(0, dot)}(${i++})${name.slice(dot)}`;
        }
        used.add(finalName);
        downloadBlob(prefix + finalName, bytes, "application/pdf");
        if (log) log(`  下载：${prefix + finalName}`);
        return finalName;
      },
      null
    );
    const xlsx = buildWorkbookBytes(pfiles);
    downloadBlob(`${prefix}送货单整理汇总.xlsx`, xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    total += pfiles.length;
  }
  return { ok: true, files: total, mode: "download" };
}

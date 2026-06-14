// 上传相关：可识别类型判断、拖拽（含文件夹递归）取文件、拖拽时的禁用判断。issue #3
export const SUPPORTED_EXTS = ["pdf", "png", "jpg", "jpeg", "bmp", "webp", "gif", "tif", "tiff"];
export const SUPPORTED_RE = /\.(pdf|png|jpe?g|bmp|webp|gif|tiff?)$/i;
export const SUPPORTED_HINT = "可识别：PDF、图片（PNG / JPG / JPEG / BMP / WEBP / GIF / TIFF）。也可以直接拖入文件夹。";

export function isSupportedFile(file) {
  return !!file && SUPPORTED_RE.test(file.name || "");
}

// dragover 时判断拖入内容里是否“可能含可识别类型”，用于设置禁用光标。
// 注意：拖拽过程中浏览器只暴露 item.kind / item.type，拿不到文件名/内容；
// 文件夹的 type 为空字符串，给予放行（drop 时再按实际文件过滤）。
export function dragHasSupported(dataTransfer) {
  const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
  if (!items.length) return true; // 信息不足时不禁用，避免误拦
  return items.some(
    (it) => it.kind === "file" && (it.type === "" || it.type === "application/pdf" || it.type.startsWith("image/"))
  );
}

function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next(); // readEntries 分批返回，需循环读到空
      }, () => resolve(all));
    next();
  });
}

async function walkEntry(entry, out) {
  if (!entry) return;
  if (entry.isFile) {
    await new Promise((res) =>
      entry.file((f) => {
        // entry.fullPath 形如 "/根文件夹/子/文件.pdf"，去掉首斜杠作相对路径
        out.push({ file: f, relPath: String(entry.fullPath || f.name).replace(/^\/+/, "") });
        res();
      }, () => res())
    );
  } else if (entry.isDirectory) {
    const entries = await readAllEntries(entry.createReader());
    for (const e of entries) await walkEntry(e, out);
  }
}

// 从一次拖放里取出 [{ file, relPath }]，支持拖入文件夹（递归展开、保留相对路径，
// 整理树按 relPath 构建 工地→组→文件 结构）。散文件 relPath 即文件名。
export async function collectDropEntries(dataTransfer) {
  const items = dataTransfer && dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const roots = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (roots.length) {
    const out = [];
    for (const entry of roots) await walkEntry(entry, out);
    return out;
  }
  return entriesFromFileList(dataTransfer && dataTransfer.files);
}

// input[webkitdirectory] / 普通 input 的 FileList → [{ file, relPath }]
export function entriesFromFileList(fileList) {
  return Array.from(fileList || []).map((f) => ({ file: f, relPath: f.webkitRelativePath || f.name }));
}

// 这批文件里是否带文件夹层级（决定走整理树还是直接入列表）
export function entriesHaveFolders(entries) {
  return (entries || []).some((e) => String(e.relPath || "").includes("/"));
}

// 兼容旧调用：只要文件数组
export async function filesFromDrop(dataTransfer) {
  return (await collectDropEntries(dataTransfer)).map((e) => e.file);
}

// 统一分拣：返回 { supported, ignored }
export function partitionFiles(files) {
  const supported = [];
  let ignored = 0;
  for (const f of files || []) {
    if (isSupportedFile(f)) supported.push(f);
    else ignored++;
  }
  return { supported, ignored };
}

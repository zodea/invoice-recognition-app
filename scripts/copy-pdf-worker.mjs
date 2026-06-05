// 把 pdfjs-dist 的 worker 和 cmaps 复制到 public/，保证与安装的 pdfjs 版本一致。
// - worker：pdf.js 文字抽取需要（getDocument）。
// - cmaps：CID 字体的电子发票抽文字需要，否则中文抽不出来。
// 由 package.json 的 postinstall 自动调用，也可手动 `node scripts/copy-pdf-worker.mjs`。
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 逐文件复制目录（cmaps 是扁平目录），比 cpSync 稳。
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of readdirSync(src)) {
    copyFileSync(join(src, name), join(dest, name));
    n++;
  }
  return n;
}

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const destDir = join(root, "public");
mkdirSync(destDir, { recursive: true });

// worker
const workerSrc = join(pdfjsRoot, "build", "pdf.worker.min.mjs");
if (existsSync(workerSrc)) {
  copyFileSync(workerSrc, join(destDir, "pdf.worker.min.mjs"));
  console.log("[copy-pdfjs] worker ->", join(destDir, "pdf.worker.min.mjs"));
} else {
  console.warn("[copy-pdfjs] 未找到 worker 源文件，跳过：" + workerSrc);
}

// cmaps（整个目录，CID 字体电子发票需要）
const cmapsSrc = join(pdfjsRoot, "cmaps");
if (existsSync(cmapsSrc)) {
  const n = copyDir(cmapsSrc, join(destDir, "cmaps"));
  console.log(`[copy-pdfjs] cmaps -> ${join(destDir, "cmaps")}（${n} 个文件）`);
} else {
  console.warn("[copy-pdfjs] 未找到 cmaps 目录，跳过：" + cmapsSrc);
}

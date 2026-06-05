// 用真实发票（发票测试/）端到端验证：抽文字 -> parseInvoice -> 排版 -> Excel。
// 运行：node scripts/test-invoices.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseInvoice } from "../src/lib/invoice-parse.js";
import { applyInvoiceFilenameFallback } from "../src/lib/invoice-filename.js";
import { buildPrintLayout } from "../src/lib/invoice-layout.js";
import { buildInvoiceWorkbookBytes } from "../src/lib/invoice-excel.js";
import { PDFDocument } from "pdf-lib";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "发票测试");
const outDir = path.join(root, "发票测试_输出");
fs.mkdirSync(outDir, { recursive: true });

// 复制 pdftext.js 的按行分组逻辑（Node 里不经 Vite，故内联）
function groupIntoLines(items, yTol = 3) {
  const arr = items
    .filter((it) => it.str != null)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
  const sorted = arr.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= yTol);
    if (!line) { line = { y: it.y, parts: [] }; lines.push(line); }
    line.parts.push(it);
  }
  return lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim());
}

const cmapsDir = path.join(root, "node_modules", "pdfjs-dist", "cmaps");
// Node 里给 pdf.js 提供从磁盘读 CMap 的工厂（浏览器用默认 HTTP fetch），
// 否则 CID 字体发票（如比音勒芬）抽不到文字。
class NodeCMapReaderFactory {
  constructor({ baseUrl } = {}) {
    this.baseUrl = baseUrl || cmapsDir;
  }
  async fetch({ name }) {
    const data = new Uint8Array(fs.readFileSync(path.join(this.baseUrl, name + ".bcmap")));
    return { cMapData: data, compressionType: 1 };
  }
}

async function extractText(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    cMapUrl: cmapsDir,
    cMapPacked: true,
    CMapReaderFactory: NodeCMapReaderFactory,
  }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out.push(...groupIntoLines(content.items));
  }
  await pdf.destroy();
  return out.join("\n");
}

const files = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".pdf")).sort();
const invoices = [];
let okCount = 0;

for (const name of files) {
  const text = await extractText(path.join(dir, name));
  fs.mkdirSync(path.join(outDir, "txt"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "txt", name + ".txt"), text);
  const f = parseInvoice(text);
  const fallback = applyInvoiceFilenameFallback(f, name);
  const note = fallback.filled.length ? "已按文件名补录，需复核" : "";
  invoices.push({ name, blob: { type: "application/pdf", arrayBuffer: async () => fs.readFileSync(path.join(dir, name)).buffer }, fields: f, note, include: true });

  // 从文件名取“真值”做对照：260120_315.33_卖方  或  dzfp_号码_卖方_时间
  const parts = name.replace(/\.pdf$/i, "").split("_");
  let truthAmount = "", truthSeller = "", truthNumber = "";
  if (/^\d{6}$/.test(parts[0])) { truthAmount = parts[1]; truthSeller = parts[2] || ""; }
  else if (parts[0] === "dzfp") { truthNumber = parts[1]; truthSeller = parts[2] || ""; }

  const checks = [];
  const amountOk = !!truthAmount && Number(f.total) === Number(truthAmount);
  const numberOk = !!truthNumber && f.number === truthNumber;
  if (truthAmount) checks.push(`金额对照 票面¥${truthAmount} 最终价税合计=${f.total}` + (amountOk ? " ✓" : " ✗"));
  if (truthNumber) checks.push(`号码对照 ${truthNumber} 最终号码=${f.number}` + (numberOk ? " ✓" : " ✗"));
  if (amountOk || numberOk) okCount++;

  console.log("—", name);
  console.log(`   号码=${f.number || "(空)"}  日期=${f.date || "(空)"}  价税合计=${f.total}  金额=${f.amount}  税额=${f.tax}`);
  console.log(`   销售方=${f.seller || "(空)"}`);
  console.log(`   购买方=${f.buyer || "(空)"}`);
  if (note) console.log(`   ${note}`);
  if (checks.length) console.log("   " + checks.join("  |  "));
}

// 批量打印排版（每页 2 张）
const layout = await buildPrintLayout(invoices, { perPage: 2 });
fs.writeFileSync(path.join(outDir, "打印版_每页2张.pdf"), Buffer.from(layout));
const lwb = await PDFDocument.load(layout);
console.log(`\n排版：${files.length} 张发票 -> ${lwb.getPageCount()} 张 A4（每页2张）`);
console.log(`   跳过无法嵌入：${(buildPrintLayout.lastSkipped || []).length} 张`);

// 明细 + 汇总账单 Excel
const xlsx = buildInvoiceWorkbookBytes(invoices);
fs.writeFileSync(path.join(outDir, "开票明细与汇总账单.xlsx"), Buffer.from(xlsx));
const total = invoices.reduce((s, inv) => s + (Number(inv.fields.total) || 0), 0);
console.log(`Excel：开票明细 + 汇总账单，已写出。价税合计总额 = ${Math.round(total * 100) / 100}`);
console.log(`\n字段识别对照通过：${okCount}/${files.length}`);
console.log(`输出目录：${outDir}`);

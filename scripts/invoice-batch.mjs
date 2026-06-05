// 发票批量整理：识别全部发票 -> 与文件名“真值”核对差异 -> 重命名输出 PDF
//   (公司：yyyy-mm-dd=金额元.pdf) -> 生成「最早~最晚」日期区间的 Excel 统计。
// 运行：node scripts/invoice-batch.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseInvoice } from "../src/lib/invoice-parse.js";
import { parseInvoiceFilename } from "../src/lib/invoice-filename.js";
import * as XLSX from "xlsx";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "发票测试");
const outDir = path.join(root, "发票测试_输出");
const preferredRenameDir = path.join(outDir, "重命名整理");

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
}

function prepareRenameDir(dir) {
  fs.mkdirSync(outDir, { recursive: true });
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (e) {
    const fallback = path.join(outDir, `重命名整理_${timestamp()}`);
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(`输出目录不可用，已改用：${fallback}`);
    console.warn(`原错误：${e.message || e}`);
    return fallback;
  }
}

const renameDir = prepareRenameDir(preferredRenameDir);

const cmapsDir = path.join(root, "node_modules", "pdfjs-dist", "cmaps");
class NodeCMapReaderFactory {
  constructor({ baseUrl } = {}) { this.baseUrl = baseUrl || cmapsDir; }
  async fetch({ name }) {
    return { cMapData: new Uint8Array(fs.readFileSync(path.join(this.baseUrl, name + ".bcmap"))), compressionType: 1 };
  }
}
function groupIntoLines(items, yTol = 3) {
  const arr = items.filter((it) => it.str != null)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of arr) {
    let line = lines.find((l) => Math.abs(l.y - it.y) <= yTol);
    if (!line) { line = { y: it.y, parts: [] }; lines.push(line); }
    line.parts.push(it);
  }
  return lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim());
}
async function extractText(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0, cMapUrl: cmapsDir, cMapPacked: true, CMapReaderFactory: NodeCMapReaderFactory }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    out.push(...groupIntoLines((await page.getTextContent()).items));
  }
  await pdf.destroy();
  return out.join("\n");
}

// 递归找所有 pdf（跳过输出目录）
function walk(dir) {
  const r = [];
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) r.push(...walk(p));
    else if (n.toLowerCase().endsWith(".pdf")) r.push(p);
  }
  return r;
}

// 文件名真值（含金额/日期/公司），三种命名：
//   260502_494.15_中海油…            (顶层：YYMMDD_金额_卖方)
//   dzfp_号码_卖方_时间戳            (数电下载名)
//   2026-05-17：50.27[-02].pdf       (发票/子目录：开票日期：金额，可带去重后缀)
function truthFromName(name) {
  const f = parseInvoiceFilename(name);
  return { date: f.date, money: f.total, company: f.seller, number: f.number, isItinerary: f.type === "行程单", hasSellerTruth: f.hasSellerTruth };
}
// 子目录名即购买方简称，用作 buyer 兜底；只认这三个目录，其它目录(发票测试/QQ邮箱…)不当买方
const BUYER_ALIAS = { 力沣: "广州力沣建筑劳务有限公司", 瑞航: "广东瑞航建设工程有限公司", 百信: "广州市百信装饰工程有限公司" };

function fmtMoney(v) { const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : ""; }
// Windows 非法字符 \ / : * ? " < > | 换成全角，保证文件名合法且贴近要求格式
function sanitize(s) {
  return String(s)
    .replace(/[\x00-\x1f]/g, "")
    .replace(/:/g, "：").replace(/\//g, "／").replace(/\\/g, "＼")
    .replace(/\*/g, "＊").replace(/\?/g, "？").replace(/"/g, "＂")
    .replace(/</g, "＜").replace(/>/g, "＞").replace(/\|/g, "｜")
    .replace(/\s+/g, "").replace(/\.+$/, "").trim();
}
function uniquePath(dir, fname) {
  let p = path.join(dir, fname), i = 2;
  const ext = path.extname(fname), stem = fname.slice(0, -ext.length);
  while (fs.existsSync(p)) { p = path.join(dir, `${stem}(${i++})${ext}`); }
  return p;
}

const files = walk(srcDir).sort();
const records = [];

for (const file of files) {
  const name = path.basename(file);
  const folder = path.basename(path.dirname(file));
  const text = await extractText(file);
  const f = parseInvoice(text);
  const t = truthFromName(name);

  // 最终取值：识别优先，识别为空则用文件名真值兜底
  const seller = f.seller || t.company || "(未识别销售方)";
  const buyer = f.buyer || BUYER_ALIAS[folder] || "";
  const date = f.date || t.date || "";
  const totalNum = f.total !== "" ? Number(f.total) : (t.money ? Number(t.money) : "");
  const number = f.number || t.number || "";

  // 核对：识别值 vs 文件名真值，记录差异
  const diffs = [];
  const moneyMismatch = t.money && f.total !== "" && Number(f.total).toFixed(2) !== Number(t.money).toFixed(2);
  const filenameMoneyLooksWrong = moneyMismatch && !t.hasSellerTruth && (f.number || f.seller);
  if (moneyMismatch && !filenameMoneyLooksWrong) diffs.push(`金额 识别${f.total}≠票面${t.money}`);
  if (t.date && f.date && f.date !== t.date) diffs.push(`日期 识别${f.date}≠文件名${t.date}`);
  if (t.number && f.number && f.number !== t.number) diffs.push(`号码 识别${f.number}≠文件名${t.number}`);
  let status;
  if (f.total === "" && !f.number && !f.seller) status = t.isItinerary ? "行程单·按文件名补录" : "未能识别(字体混淆)·按文件名补录";
  else if (filenameMoneyLooksWrong) status = `文件名金额疑似录错·以识别票面${Number(f.total).toFixed(2)}为准`;
  else if (diffs.length) status = "有差异: " + diffs.join("; ");
  else if (f.total === "") status = "金额未识别·取自文件名" + (f.seller ? "(销售方已识别)" : "");
  else status = "识别一致";

  // 重命名输出
  const newName = `${sanitize(seller)}：${date || "无日期"}=${fmtMoney(totalNum) || "0.00"}元.pdf`;
  const dest = uniquePath(renameDir, newName);
  fs.copyFileSync(file, dest);

  records.push({
    name, file, seller, buyer, date, number,
    amount: f.amount, tax: f.tax, total: totalNum, type: f.type || (t.isItinerary ? "行程单" : ""),
    status, newName: path.basename(dest),
  });
  console.log(`${status === "识别一致" || status.startsWith("文件名金额") ? "OK " : (status.startsWith("有差异") ? "DIFF" : "FB ")} ${name}`);
  console.log(`    -> ${path.basename(dest)}   [${status}]`);
}

// 日期区间
const dates = records.map((r) => r.date).filter(Boolean).sort();
const minD = dates[0] || "", maxD = dates[dates.length - 1] || "";
const slash = (d) => d ? d.replace(/-/g, "/") : "(无)";
const dot = (d) => d ? d.replace(/-/g, ".") : "无";

// —— Excel ——
const wb = XLSX.utils.book_new();
const num = (v) => (v === "" || v == null ? "" : (Number.isFinite(Number(v)) ? Number(v) : v));
const sorted = [...records].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
const detail = [
  [`发票统计（开票日期 ${slash(minD)} 至 ${slash(maxD)}，共 ${records.length} 张）`],
  ["序号", "开票日期", "销售方(收款方)", "购买方(付款方)", "发票号码", "金额(税前)", "税额", "价税合计", "发票类型", "识别核对", "原文件名", "重命名后"],
];
sorted.forEach((r, i) => detail.push([
  i + 1, r.date ? r.date.replace(/-/g, "/") : "", r.seller, r.buyer, r.number,
  num(r.amount), num(r.tax), num(r.total), r.type, r.status, r.name, r.newName,
]));
const ws = XLSX.utils.aoa_to_sheet(detail);
ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 11 } }];
ws["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 30 }, { wch: 26 }, { wch: 22 }, { wch: 11 }, { wch: 9 }, { wch: 11 }, { wch: 10 }, { wch: 26 }, { wch: 40 }, { wch: 34 }];
XLSX.utils.book_append_sheet(wb, ws, "开票明细");

// 汇总（按销售方）
const bySeller = new Map();
let tA = 0, tT = 0, tTot = 0;
for (const r of records) {
  const s = r.seller || "(未识别)";
  if (!bySeller.has(s)) bySeller.set(s, { c: 0, a: 0, t: 0, tot: 0 });
  const g = bySeller.get(s);
  g.c++; g.a += Number(r.amount) || 0; g.t += Number(r.tax) || 0; g.tot += Number(r.total) || 0;
  tA += Number(r.amount) || 0; tT += Number(r.tax) || 0; tTot += Number(r.total) || 0;
}
const r2 = (x) => Math.round(x * 100) / 100;
const sumRows = [
  [`汇总账单（${slash(minD)} ~ ${slash(maxD)}）`],
  ["销售方(收款方)", "张数", "金额合计", "税额合计", "价税合计"],
];
for (const [s, g] of bySeller.entries()) sumRows.push([s, g.c, r2(g.a), r2(g.t), r2(g.tot)]);
sumRows.push(["合计", records.length, r2(tA), r2(tT), r2(tTot)]);
const sws = XLSX.utils.aoa_to_sheet(sumRows);
sws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
sws["!cols"] = [{ wch: 32 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
XLSX.utils.book_append_sheet(wb, sws, "汇总账单");

const xlsxName = `发票统计_${dot(minD)}至${dot(maxD)}.xlsx`;
const xlsxPath = path.join(outDir, xlsxName);
fs.writeFileSync(xlsxPath, Buffer.from(XLSX.write(wb, { type: "array", bookType: "xlsx" })));

console.log(`\n开票日期区间：${slash(minD)} 至 ${slash(maxD)}`);
console.log(`价税合计总额：¥${r2(tTot)}`);
console.log(`重命名输出：${records.length} 个 PDF -> ${renameDir}`);
console.log(`Excel 统计：${xlsxPath}`);

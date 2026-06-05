// 端到端自测：用真实发票 PDF，跑“与 UI 完全相同”的识别+整理逻辑（复用 src/lib 真模块），
// 校验我修过的疑难版式与整理导出命名/分目录/去重。运行：node scripts/e2e-selftest.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseInvoice, classifyDocType, isProbablyInvoiceText } from "../src/lib/invoice-parse.js";
import { applyInvoiceFilenameFallback } from "../src/lib/invoice-filename.js";
import { markInvoiceDuplicates } from "../src/lib/invoice-dedupe.js";
import { invoiceExportFileName, exportParentFolderName, invoiceFolderParts } from "../src/lib/invoice-export-package.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cmapsDir = path.join(root, "node_modules", "pdfjs-dist", "cmaps");
class CMap { constructor({ baseUrl } = {}) { this.baseUrl = baseUrl || cmapsDir; } async fetch({ name }) { return { cMapData: new Uint8Array(fs.readFileSync(path.join(this.baseUrl, name + ".bcmap"))), compressionType: 1 }; } }
function lines(items, t = 3) {
  const a = items.filter((i) => i.str != null).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] })).sort((p, q) => q.y - p.y || p.x - q.x);
  const L = [];
  for (const it of a) { let l = L.find((x) => Math.abs(x.y - it.y) <= t); if (!l) { l = { y: it.y, p: [] }; L.push(l); } l.p.push(it); }
  return L.map((l) => l.p.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim());
}
async function extractText(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, verbosity: 0, cMapUrl: cmapsDir, cMapPacked: true, CMapReaderFactory: CMap }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); out.push(...lines((await pg.getTextContent()).items)); }
  await pdf.destroy();
  return out.join("\n");
}

// 复刻 invoiceStore.recognizeOne 的字段填充顺序：parseInvoice 先填，文件名再兜底
function applyParsed(fields, parsed) {
  for (const k of Object.keys(parsed)) if ((fields[k] === "" || fields[k] == null) && parsed[k] !== "" && parsed[k] != null) fields[k] = parsed[k];
}

const FILES = [
  { p: "发票测试/QQ邮箱发票_共35张_总金额9101.92元/260502_494.15_中海油国油能源（东莞）有限公司.pdf", name: "260502_494.15_中海油国油能源（东莞）有限公司.pdf" },
  { p: "发票测试/发票/力沣/2026-03-29：390.26.pdf", name: "2026-03-29：390.26.pdf", folder: "力沣" },
  { p: "发票测试/发票/瑞航/2026-04-22：188.30.pdf", name: "2026-04-22：188.30.pdf", folder: "瑞航" },
  { p: "发票测试/发票/瑞航/2026-04-11：20.52.pdf", name: "2026-04-11：20.52.pdf", folder: "瑞航" },
  { p: "发票测试/发票/瑞航/2026-05-23：125.00.pdf", name: "2026-05-23：125.00.pdf", folder: "瑞航" },
  { p: "发票测试/发票/瑞航/2026-03-24：53.37.pdf", name: "2026-03-24：53.37.pdf", folder: "瑞航" },
  { p: "发票测试/发票/瑞航/2026-05-04：3.70.pdf", name: "2026-05-04：3.70.pdf", folder: "瑞航" },
  { p: "发票测试/QQ邮箱发票_共35张_总金额9101.92元/260515_67.75_广州优行科技有限公司_行程单.pdf", name: "260515_67.75_广州优行科技有限公司_行程单.pdf" },
  { p: "发票测试/发票/瑞航/2026-04-11：552.00.pdf", name: "2026-04-11：552.00.pdf", folder: "瑞航" },
  { p: "发票测试/发票/瑞航/2026-04-11：552.00-02.pdf", name: "2026-04-11：552.00-02.pdf", folder: "瑞航" },
];
const BUYER_ALIAS = { 力沣: "广州力沣建筑劳务有限公司", 瑞航: "广东瑞航建设工程有限公司", 百信: "广州市百信装饰工程有限公司" };

const invoices = [];
for (const f of FILES) {
  const text = await extractText(path.join(root, f.p));
  const fields = { code: "", number: "", date: "", dateText: "", buyer: "", seller: "", amount: "", tax: "", total: "", rate: "", type: "", docType: "", remark: "" };
  if (isProbablyInvoiceText(text)) applyParsed(fields, parseInvoice(text)); // 与 UI 完全相同的门槛
  applyInvoiceFilenameFallback(fields, f.name);
  if (!fields.buyer && f.folder && BUYER_ALIAS[f.folder]) fields.buyer = BUYER_ALIAS[f.folder]; // UI 里目录兜底买方
  invoices.push({ id: f.name, name: f.name, fields, include: true, status: "done" });
}
// 真重复：克隆一张已识别发票（同号同内容）追加进去，应被去重标记。
// 注：552.00 与 552.00-02 是“同日期同金额同销方但发票号码不同”的两张真实不同发票，
// 去重按内容指纹+号码判定，正确地不会把它们合并（这点本身也是要验证的行为）。
const clone = JSON.parse(JSON.stringify(invoices[0]));
clone.id = "clone"; clone.name = "中海油_重复件.pdf"; clone.include = true;
invoices.push(clone);
const dupCount = markInvoiceDuplicates(invoices);
const pair552 = invoices.filter((i) => i.name.includes("552.00"));

let pass = 0, fail = 0;
const ok = (n, c, extra = "") => { if (c) { pass++; console.log("  OK  " + n); } else { fail++; console.log("  XX  " + n + (extra ? "  => " + extra : "")); } };
const byName = (s) => invoices.find((x) => x.name.includes(s));

console.log("== 识别字段校验（真实PDF）==");
const zhonghaiyou = byName("中海油");
ok("中海油 买卖方未并到一起", zhonghaiyou.fields.seller.includes("中海油") && zhonghaiyou.fields.buyer.includes("广东瑞航"), `卖=${zhonghaiyou.fields.seller} 买=${zhonghaiyou.fields.buyer}`);
const shihua = byName("390.26");
ok("中石化390.26 买方=力沣(非买售)", shihua.fields.buyer === "广州力沣建筑劳务有限公司" && shihua.fields.seller.includes("中国石化"), `买=${shihua.fields.buyer}`);
const mcd = byName("188.30");
ok("麦当劳 卖方=麦当劳食品(部首修正)", mcd.fields.seller === "广东三元麦当劳食品有限公司", mcd.fields.seller);
ok("麦当劳 日期=2026-04-22", mcd.fields.date === "2026-04-22", mcd.fields.date);
ok("麦当劳 价税合计=188.30", Number(mcd.fields.total) === 188.3, String(mcd.fields.total));
const yk = byName("20.52");
ok("永康专票 卖方名不被空格截断", yk.fields.seller === "永康市锦霸贸易有限公司", yk.fields.seller);
ok("永康专票 价税合计=20.52", Number(yk.fields.total) === 20.52, String(yk.fields.total));
const gh = byName("125.00");
ok("冠晖 买方=广东瑞航(无尾“售”)", gh.fields.buyer === "广东瑞航建设工程有限公司", gh.fields.buyer);
ok("冠晖 卖方=冠晖物业", gh.fields.seller === "广州市冠晖物业管理有限公司", gh.fields.seller);
const hll = byName("53.37");
ok("货拉拉 docType=货物运输凭证", hll.fields.docType === "货物运输凭证", hll.fields.docType);
ok("货拉拉 买方=托运人广东瑞航", hll.fields.buyer === "广东瑞航建设工程有限公司", hll.fields.buyer);
ok("货拉拉 金额=53.37", Number(hll.fields.total) === 53.37, String(hll.fields.total));
const ali = byName("3.70");
ok("阿里 价税合计识别=32.19(非文件名3.70)", Number(ali.fields.total) === 32.19, String(ali.fields.total));
const trip = byName("行程单");
ok("行程单 docType=行程单", trip.fields.docType === "行程单", trip.fields.docType);
ok("行程单 金额=67.75", Number(trip.fields.total) === 67.75, String(trip.fields.total));

console.log("== 去重 ==");
ok("克隆的重复件被去重(共1张)", dupCount === 1, `dupCount=${dupCount}`);
ok("被标记的是克隆件", invoices.find((i) => i.id === "clone")?.duplicateReason, "");
ok("552.00/552.00-02 号码不同→正确地不合并", pair552.length === 2 && pair552.every((i) => !i.duplicateReason), `号码: ${pair552.map((i) => i.fields.number).join(",")}`);

console.log("== 整理导出命名 / 分目录 ==");
ok("父文件夹按日期区间", exportParentFolderName(invoices) === "发票整理_2026-03-24至2026-05-23", exportParentFolderName(invoices));
ok("中海油整理后文件名", invoiceExportFileName(zhonghaiyou) === "中海油国油能源(东莞)有限公司：2026-05-02=494.15元.pdf", invoiceExportFileName(zhonghaiyou));
ok("分目录[购买方/类型] 货拉拉路径", JSON.stringify(invoiceFolderParts(hll, ["buyer", "type"])) === JSON.stringify(["广东瑞航建设工程有限公司", "货物运输凭证"]), JSON.stringify(invoiceFolderParts(hll, ["buyer", "type"])));
ok("分目录[发票类型] 麦当劳=普通发票", JSON.stringify(invoiceFolderParts(mcd, ["type"])) === JSON.stringify(["普通发票"]), JSON.stringify(invoiceFolderParts(mcd, ["type"])));

console.log("\n明细一览：");
for (const inv of invoices) {
  const fdr = inv.fields;
  console.log(`  ${inv.duplicateReason ? "[重复]" : "      "} ${inv.name}`);
  console.log(`         销:${fdr.seller || "(空)"} | 买:${fdr.buyer || "(空)"} | ${fdr.date || "(空)"} | ¥${fdr.total || "(空)"} | ${fdr.docType}/${fdr.type || ""}`);
  console.log(`         整理后 -> ${invoiceExportFileName(inv)}`);
}
console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);

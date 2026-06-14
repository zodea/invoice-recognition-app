// PaddleOCR-VL-1.6 真实送货单批量识别对比测试（Node 直连，无浏览器/CORS）。
// 复用项目真正的解析器 src/lib/vl-parse.js，验证「云端识别质量 + 本地解析」端到端。
//
// 用法（token 走环境变量，不写进文件/仓库）：
//   PowerShell:  $env:VL_TOKEN="<token>"; node scripts/vl-batch-test.mjs
//   bash:        VL_TOKEN=<token> node scripts/vl-batch-test.mjs
//
// 产物：scripts/vl-out/<简称>.md（原始 markdown）+ 控制台对比表。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVlToDocs } from "../src/lib/vl-parse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(__dirname, "vl-out");

const API = "https://paddleocr.aistudio-app.com/api/v2/ocr/jobs";
const MODEL = "PaddleOCR-VL-1.6";
const TOKEN = process.env.VL_TOKEN || "";
const OPTIONS = { useDocOrientationClassify: true, prettifyMarkdown: true };
const POLL_MS = 3000;
const POLL_MAX_MS = 300000;

// 用户点名的 6 家，各取一份代表性送货单。
const SHARE = path.join(APP_ROOT, "送货单", "合和新城送货单共享文件夹");
const CASES = [
  { name: "大板东", file: path.join(SHARE, "大板东", "2026.5.23大板东.pdf") },
  { name: "富丰建材", file: path.join(SHARE, "富丰建材", "2026.4.26富丰建材.pdf") },
  { name: "兴逾丰", file: path.join(SHARE, "兴逾丰贸易", "2026.5.11兴逾丰.pdf") },
  { name: "智道", file: path.join(SHARE, "佛山市智道建筑材料有限公司", "2026.5.12智道.pdf") },
  { name: "广东鹏程", file: path.join(SHARE, "广东鹏程", "2026.5.16鹏程.pdf") },
  { name: "南洋电线", file: path.join(SHARE, "南洋电线", "2026.5.27南洋电线.pdf") },
];

const authHeaders = () => ({ Authorization: `bearer ${TOKEN}` });
const unwrap = (j) => (j && j.data && typeof j.data === "object" ? j.data : j && j.result && typeof j.result === "object" ? j.result : j);
const now = () => new Date().toTimeString().slice(0, 8);
const log = (tag, msg) => console.log(`[${now()}] ${tag.padEnd(8)} ${msg}`);

async function submit(c) {
  const buf = await fs.readFile(c.file);
  const form = new FormData();
  form.append("model", MODEL);
  form.append("optionalPayload", JSON.stringify(OPTIONS));
  form.append("file", new Blob([buf], { type: "application/pdf" }), path.basename(c.file));
  const resp = await fetch(API, { method: "POST", headers: authHeaders(), body: form });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`提交失败 ${resp.status}: ${text.slice(0, 160)}`);
  const data = unwrap(JSON.parse(text));
  const jobId = data.jobId || data.id;
  if (!jobId) throw new Error(`无 jobId: ${text.slice(0, 160)}`);
  return jobId;
}

async function poll(c, jobId) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (Date.now() - t0 > POLL_MAX_MS) throw new Error("轮询超时 5 分钟");
    const resp = await fetch(`${API}/${encodeURIComponent(jobId)}`, { headers: authHeaders() });
    const data = unwrap(await resp.json());
    const state = data.state || data.status;
    const p = data.extractProgress || {};
    if (state === "running" && p.totalPages) log(c.name, `解析中 ${p.extractedPages || 0}/${p.totalPages} 页`);
    if (state === "failed") throw new Error(`识别失败: ${data.errorMsg || "?"}`);
    if (state === "done") {
      const jsonUrl = data.resultUrl && (data.resultUrl.jsonUrl || data.resultUrl.json);
      if (!jsonUrl) throw new Error("done 但无 resultUrl.jsonUrl");
      return jsonUrl;
    }
  }
}

function parseResultText(text) {
  const trimmed = String(text || "").trim();
  const pages = [];
  const pushPieces = (obj) => {
    const r = unwrap(obj);
    if (r && Array.isArray(r.layoutParsingResults)) {
      for (const lp of r.layoutParsingResults) {
        const md = (lp && lp.markdown && (lp.markdown.text ?? lp.markdown)) || lp.markdownText || "";
        if (md) pages.push(String(md));
      }
    }
  };
  try {
    pushPieces(JSON.parse(trimmed));
  } catch {
    for (const line of trimmed.split(/\r?\n/)) {
      const s = line.trim();
      if (s) pushPieces(JSON.parse(s));
    }
  }
  return pages;
}

async function fetchResult(jsonUrl) {
  const resp = await fetch(jsonUrl);
  if (!resp.ok) throw new Error(`下载结果失败 ${resp.status}`);
  return parseResultText(await resp.text());
}

async function runOne(c, delayMs = 0) {
  const t0 = Date.now();
  try {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs)); // 错峰提交，避开 429 限流
    log(c.name, "提交…");
    const jobId = await submit(c);
    log(c.name, `已提交 job=${jobId}`);
    const jsonUrl = await poll(c, jobId);
    const markdownPages = await fetchResult(jsonUrl);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const fullMd = markdownPages.join("\n\n---PAGE---\n\n");
    await fs.writeFile(path.join(OUT_DIR, `${c.name}.md`), fullMd, "utf8");
    const { docs, company } = parseVlToDocs(markdownPages);
    log(c.name, `✓ 完成 ${secs}s，页=${markdownPages.length}，公司=「${company || "?"}」，拆出 ${docs.length} 单`);
    return { ...c, ok: true, secs, pages: markdownPages.length, company, docs, mdLen: fullMd.length };
  } catch (e) {
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    log(c.name, `✗ 失败 ${secs}s：${e.message}`);
    return { ...c, ok: false, secs, error: e.message };
  }
}

function report(results) {
  console.log("\n================= VL-1.6 识别对比 =================");
  for (const r of results) {
    console.log(`\n■ ${r.name}  [${path.basename(r.file)}]`);
    if (!r.ok) {
      console.log(`   ✗ ${r.error}（${r.secs}s）`);
      continue;
    }
    console.log(`   耗时 ${r.secs}s | 页数 ${r.pages} | markdown ${r.mdLen} 字 | 公司「${r.company || "?"}」 | ${r.docs.length} 单`);
    r.docs.forEach((d, i) => {
      console.log(`   单${i + 1}: 日期=${d.date || "-"} 单号=${d.orderNo || "-"} 公司=${d.company || "-"} 明细=${d.items.length} 行`);
      d.items.slice(0, 6).forEach((it) => {
        console.log(`       · ${it.name} | ${it.unit || "-"} | 数量${it.quantity || "-"} | 单价${it.unitPrice || "-"} | 金额${it.total || "-"}`);
      });
      if (d.items.length > 6) console.log(`       …还有 ${d.items.length - 6} 行`);
    });
  }
  const ok = results.filter((r) => r.ok).length;
  const withItems = results.filter((r) => r.ok && r.docs.some((d) => d.items.length)).length;
  console.log(`\n小结：成功 ${ok}/${results.length}，其中 ${withItems} 家解析出材料明细。原始 markdown 见 scripts/vl-out/。`);
}

async function main() {
  if (!TOKEN) {
    console.error("缺少 VL_TOKEN 环境变量。PowerShell: $env:VL_TOKEN=\"<token>\"; node scripts/vl-batch-test.mjs");
    process.exit(1);
  }
  await fs.mkdir(OUT_DIR, { recursive: true });
  // 先确认文件都在
  for (const c of CASES) {
    try { await fs.access(c.file); } catch { log(c.name, `⚠ 文件不存在：${c.file}`); }
  }
  log("START", `并发识别 ${CASES.length} 家（错峰提交）…`);
  const results = await Promise.all(CASES.map((c, i) => runOne(c, i * 1500)));
  report(results);
}

main().catch((e) => { console.error("脚本异常：", e); process.exit(1); });

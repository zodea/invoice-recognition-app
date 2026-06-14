// 解析 PaddleOCR-VL 返回的 Markdown（每页一段）→ 送货单结构。
// 关键事实：VL 把表格输出成 HTML <table>（整段一行），抬头/客户/日期是普通文字行，
// 标题常带 Markdown 记号（# 一级标题、<div> 居中、$^{®}$ LaTeX、商标符）。
// 一份文件可能多张单（多页/多表）：按"表格"切段，每个表格连同它上方文字（公司/日期/单号）算一张单
// —— 这就是"一个扫描 PDF 拆成多张单"的自动实现。
// 列名按关键词对应：品名/名称/产品→材料名称，单位，数量，单价，金额/总价→总价。
// 解析不保证全对，识别后仍以人工核对为准（CONTEXT：待复核）。
import { findDate, findOrderNo, findCompany, parseItemLines, COMPANY_HINTS } from "./parse.js";

// —— 行内清洗：去 HTML 标签 / LaTeX / Markdown 记号 / 商标符 / 实体 ——
export function stripInline(line) {
  return String(line || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\*\*/g, "") // 去 markdown 粗体，但保留单个 *（尺寸如 8*6）
    .replace(/[#>`®™]/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// —— Markdown 竖线表格（兼容旧用例 / 电子票） ——
function splitRow(line) {
  let s = String(line).trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.replace(/<[^>]+>/g, "").trim());
}
function isTableLine(line) {
  const s = String(line).trim();
  return s.includes("|") && s.split("|").length >= 3;
}
function isSeparatorRow(cells) {
  return cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "");
}

// —— HTML 表格（VL 的实际输出格式）——
// 一行里可能有一个或多个 <table>…</table>；每个解析成 rows(cells[])。
// 单格整行（<td colspan=N> 备注/大写合计/说明文字）直接丢弃——它们不是材料行。
function parseHtmlTables(line) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(line))) {
    const rows = [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = trRe.exec(tm[1]))) {
      const cells = [];
      const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = tdRe.exec(rm[1]))) cells.push(stripInline(cm[1]));
      if (cells.length <= 1) continue; // 整行说明（备注/大写合计）→ 丢
      rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

// 把一段 markdown 切成 [{ kind:'text', lines } | { kind:'table', rows }]
export function splitMarkdownBlocks(md) {
  const blocks = [];
  let cur = null;
  for (const line of String(md || "").split(/\r?\n/)) {
    if (/<table\b/i.test(line)) {
      for (const rows of parseHtmlTables(line)) blocks.push({ kind: "table", rows });
      cur = null;
      continue;
    }
    if (isTableLine(line)) {
      const cells = splitRow(line);
      if (isSeparatorRow(cells)) continue; // |---|---| 分隔行丢弃
      if (!cur || cur.kind !== "table") {
        cur = { kind: "table", rows: [] };
        blocks.push(cur);
      }
      cur.rows.push(cells);
      continue;
    }
    const cleaned = stripInline(line);
    if (!cleaned) continue;
    if (!cur || cur.kind !== "text") {
      cur = { kind: "text", lines: [] };
      blocks.push(cur);
    }
    cur.lines.push(cleaned);
  }
  return blocks;
}

// 列名 → 字段 的关键词映射
const COL_KEYS = [
  { key: "name", re: /品名|名称|材料|项目|规格|货名|产品|商品/ },
  { key: "unit", re: /单位/ },
  { key: "quantity", re: /数量|总数量/ },
  { key: "unitPrice", re: /单价/ },
  { key: "total", re: /金额|总价|小计/ },
  { key: "note", re: /备注/ },
];

function mapHeader(cells) {
  const map = {};
  let hits = 0;
  cells.forEach((c, i) => {
    for (const { key, re } of COL_KEYS) {
      if (re.test(c) && map[key] == null) {
        map[key] = i;
        hits++;
        break;
      }
    }
  });
  return hits >= 2 ? map : null; // 至少命中两列才算表头
}

function toNum(s) {
  const n = Number(String(s ?? "").replace(/[,，\s¥￥元]/g, ""));
  return Number.isFinite(n) && String(s).trim() !== "" ? n : "";
}

const SUM_ROW_RE = /合\s*计|总\s*计|大写|应收|实收/;
const NOTE_NAME_RE = /^(备注|说明|大写|送货方式|注意|白色联|红色联|黄色联|绿色联|蓝色联|存根)/;

// 一个表格 → 材料行数组
export function tableToItems(rows) {
  if (!rows.length) return [];
  let header = mapHeader(rows[0]);
  let dataRows = rows.slice(1);
  if (!header) {
    // 无表头：按典型列序 猜（序号? 品名 单位 数量 单价 金额）
    const w = rows[0].length;
    if (w >= 5) {
      const off = /^\d+$/.test(rows[0][0]) || /序/.test(rows[0][0]) ? 1 : 0;
      header = { name: off, unit: off + 1, quantity: off + 2, unitPrice: off + 3, total: off + 4 };
      dataRows = rows;
    } else {
      return [];
    }
  }
  if (header.name == null) header.name = 0; // 表头没有品名列（扫描差）→ 默认第一列为品名
  const items = [];
  for (const cells of dataRows) {
    const joined = cells.join("");
    if (!joined) continue;
    if (SUM_ROW_RE.test(joined)) continue; // 合计行不进明细
    const name = (header.name != null ? cells[header.name] : "") || "";
    if (!name || /^[-—\s]*$/.test(name)) continue;
    if (/^\d+(?:\.\d+)?$/.test(name)) continue; // 纯数字（印章/数量漏进品名列）→ 丢
    if (/品名|名称|材料|产品/.test(name)) continue; // 重复表头
    if (NOTE_NAME_RE.test(name)) continue; // 说明/备注落到品名列
    items.push({
      name,
      unit: header.unit != null ? cells[header.unit] || "" : "",
      quantity: header.quantity != null ? toNum(cells[header.quantity]) : "",
      unitPrice: header.unitPrice != null ? toNum(cells[header.unitPrice]) : "",
      total: header.total != null ? toNum(cells[header.total]) : "",
      ...(header.note != null && cells[header.note] ? { note: cells[header.note] } : {}),
    });
  }
  return items;
}

// —— 供货商（抬头公司）识别 ——
// 取"文档顺序最靠前、命中公司关键词、且不是买方/地址/经办字段"的行（多为抬头标题）。
// 这样能避开"客户名称：…""需方单位：…""地址：…"被错当成供货商（之前按最长行选会选错）。
const BUYER_FIELD_RE =
  /^(客户|需方|供方|收货单位|收货|送货地址|送货地点|送货|项目名称|项目|地址|电话|订货电话|订货地址|联系电话|联系人|开户|账号|税号|经手|经办|制单|司机|审核|审批|签收|签字|承运|备注|日期)/;
const DOCTYPE_TAIL_RE = /(送货单|销货清单|销售清单|出货单|送货清单|发货单|销售单|对账单|清单|送货)$/;

export function pickSupplier(lines) {
  const cleaned = (lines || []).map(stripInline).filter(Boolean);
  let fallback = "";
  for (const raw of cleaned) {
    const s = raw.replace(/\s+/g, "");
    if (BUYER_FIELD_RE.test(s)) continue;
    if (!COMPANY_HINTS.test(s)) continue;
    if (s.length < 4 || s.length > 30) continue;
    const name = s.replace(DOCTYPE_TAIL_RE, "").trim();
    if (name.length >= 3) return name; // 抬头优先（文档最靠前的命中行）
    if (!fallback) fallback = s;
  }
  return fallback;
}

// markdown 页数组 → { docs, company, rawText }
// 每个表格成一张单；表格之前（自上一个表格以来）的文字给这张单提供 公司/日期/单号。
export function parseVlToDocs(markdownPages) {
  const pages = markdownPages || [];
  const rawText = pages.join("\n\n").replace(/<[^>]+>/g, "");
  const allLines = pages.flatMap((md) => String(md).split(/\r?\n/)).map(stripInline).filter(Boolean);
  const fileCompany = pickSupplier(allLines);
  const docs = [];

  for (const md of pages) {
    const blocks = splitMarkdownBlocks(md);
    let pendingText = [];
    for (const b of blocks) {
      if (b.kind === "text") {
        pendingText.push(...b.lines);
        continue;
      }
      const items = tableToItems(b.rows);
      if (!items.length) continue; // 空/版式表格不算一张单
      const headText = pendingText.join("\n");
      const company = pickSupplier(pendingText) || fileCompany || findCompany(pendingText) || "";
      const date = findDate(pendingText) || findDate(allLines);
      const orderNo = findOrderNo(pendingText) || "";
      docs.push({
        company,
        date: date || null,
        dateText: date || "",
        orderNo,
        items,
        itemsSource: "table",
        headText,
      });
      pendingText = []; // 下一张单的头部从这里重新积累
    }
  }

  // 全文兜底：没有任何带明细的表格单 → 单张，按纯文本解析
  if (!docs.length) {
    const date = findDate(allLines);
    const items = parseItemLines(allLines);
    docs.push({
      company: fileCompany || findCompany(allLines) || "",
      date: date || null,
      dateText: date || "",
      orderNo: findOrderNo(allLines) || "",
      items,
      itemsSource: items.length ? "line" : "",
      headText: "",
    });
  }

  return { docs, company: fileCompany || docs.find((d) => d.company)?.company || "", rawText };
}

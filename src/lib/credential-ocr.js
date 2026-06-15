// 分供方证照的本地 OCR 归类 + 字段抽取（ADR-0002）。
// 证照是规范印刷件，用本地 PP-OCRv2（ocr.js）即可，不走云 VL。
// classifyDoc / extractCredentialFields 是纯函数（可离线单测）；recognizeCredentialFile 在浏览器侧跑渲染+识别。
import { renderFileToPages } from "./pdf.js";
import { recognizeDataUrl } from "./ocr.js";

function joinLines(lines) {
  return (Array.isArray(lines) ? lines : String(lines || "").split(/\r?\n/)).map((s) => String(s).trim()).filter(Boolean);
}

// 关键词归类 → 类别（与 supplier-db ATTACHMENT_CATEGORIES 对应）；不确定返回 ""（调用方保留文件名猜测）。
export function classifyDoc(lines) {
  const t = joinLines(lines).join("").replace(/\s+/g, "");
  if (/营业执照|统一社会信用代码|登记机关/.test(t)) return "营业执照";
  if (/开户许可证|基本存款账户|核准号/.test(t)) return "银行开户许可证";
  if (/居民身份证|公民身份号码|身份号码/.test(t)) return "法人身份证"; // 法人/签约代表 仅凭内容难分，默认法人，可手改
  if (/授权(书|证明)|品牌授权|授权代理/.test(t)) return "品牌授权证明";
  return "";
}

// 取“标签后面的值”：同一行标签后剩余文字，没有则取下一行。
function valueAfter(arr, labelRe) {
  for (let i = 0; i < arr.length; i++) {
    const m = arr[i].match(labelRe);
    if (!m) continue;
    const rest = arr[i].slice((m.index || 0) + m[0].length).replace(/^[:：\s]+/, "").trim();
    if (rest) return rest;
    if (arr[i + 1]) return arr[i + 1].trim();
  }
  return "";
}

// 按类别从 OCR 文本行抽分供方字段（部分）。回填规则由调用方决定（只填空、冲突不覆盖）。
export function extractCredentialFields(category, lines) {
  const arr = joinLines(lines);
  const text = arr.join("\n");
  const out = {};
  if (category === "营业执照") {
    out.name = valueAfter(arr, /名\s*称/);
    const code = text.replace(/\s/g, "").match(/[0-9A-Z]{18}/);
    if (code) out.taxNo = code[0];
    out.legalRep = valueAfter(arr, /法定代表人|负责人|经营者/);
    out.address = valueAfter(arr, /住\s*所|经营场所|住址|地\s*址/);
  } else if (category === "银行开户许可证") {
    out.bank = valueAfter(arr, /开户银行|开户行|银行名称/);
    const acct = text.replace(/\s/g, "").match(/(?:账号|帐号|账户)[:：]?([0-9]{8,30})/);
    if (acct) out.bankAccount = acct[1];
  } else if (category === "法人身份证" || category === "签约代表身份证") {
    const name = valueAfter(arr, /姓\s*名/);
    if (name) out.legalRep = name; // 身份证→姓名，默认落到法人（可手改到联系人）
  }
  for (const k of Object.keys(out)) if (!out[k] || /^[-—\s]*$/.test(out[k])) delete out[k];
  return out;
}

// 浏览器侧：渲染上传文件 → 本地 OCR → 归类 + 抽字段。返回 { category, fields, lines }。
export async function recognizeCredentialFile(file, onProgress) {
  const { pages } = await renderFileToPages(file);
  if (!pages || !pages.length) return { category: "", fields: {}, lines: [] };
  const lines = await recognizeDataUrl(pages[0].dataUrl, onProgress);
  const category = classifyDoc(lines);
  return { category, fields: extractCredentialFields(category, lines), lines };
}

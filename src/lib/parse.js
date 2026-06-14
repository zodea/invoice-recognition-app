// 从 OCR 文本行里“尽力”抽取 日期 / 单号 / 公司 / 材料明细 / 候选品名。
// 手写送货单识别不可能 100% 准确，这里只做预填，最终以人工核对为准。

const CN_NUM = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

function pad2(n) {
  return String(n).padStart(2, "0");
}

// 识别日期：支持 2026年3月9日 / 2026.03.09 / 2026-3-9 / 2026/03/09
export function findDate(lines) {
  const text = lines.join(" ");
  const m =
    text.match(/(20\d{2})\s*[年.\-\/]\s*(\d{1,2})\s*[月.\-\/]\s*(\d{1,2})/) ||
    text.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  return null;
}

// 送货单单号多是带前导零的红色流水号（如 0005876）；预印单上紧挨税号印刷，
// OCR 易把两者粘成长串（191206840950005876，尾部 0005876 才是单号）。取尾部前导零流水号。
function trailingSerial(s) {
  const m = String(s).match(/(0{2,}\d{2,})$/);
  return m ? m[1] : "";
}

// 识别单号：优先“单号/编号/No”后面的串，否则取最长的一串 6+ 位数字/字母。
// 长纯数字串（≥15 位）疑似税号/统一社会信用代码：只取其尾部红色流水号，
// 取不出则留空（宁空勿错，由调用方按“待复核”兜底，见 issue #8）。
export function findOrderNo(lines) {
  for (const line of lines) {
    const m = line.match(/(?:单据?编?号|编号|N[oO]\.?|NO\.?)\s*[:：]?\s*([A-Za-z0-9\-]{4,})/);
    if (m) return m[1];
  }
  let best = "";
  for (const line of lines) {
    const all = line.match(/[A-Za-z0-9\-]{6,}/g) || [];
    for (const s of all) if (/\d{4,}/.test(s) && s.length > best.length) best = s;
  }
  if (!best) return "";
  if (/^\d{15,}$/.test(best)) return trailingSerial(best);
  return best;
}

// 识别公司名：含“有限公司/经营部/商行/厂/贸易/电缆/建材”等关键词的最长行。
export const COMPANY_HINTS = /(有限公司|有限责任公司|经营部|商行|商贸|贸易|建材|电缆|照明|装饰|设备|厂|店)/;
export function findCompany(lines) {
  let best = "";
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, "");
    if (COMPANY_HINTS.test(line) && line.length >= 4 && line.length <= 30) {
      if (line.length > best.length) best = line;
    }
  }
  return best;
}

const UNIT_RE =
  /^(?:个|件|套|张|块|片|条|支|根|包|袋|盒|瓶|桶|罐|卷|捆|扎|台|把|只|双|副|米|m|M|厘米|cm|CM|平方|平方米|㎡|m2|M2|立方|方|m3|M3|吨|t|T|公斤|kg|KG|斤|车|次|项)$/;
const UNIT_IN_TOKEN_RE =
  /^(?:个|件|套|张|块|片|条|支|根|包|袋|盒|瓶|桶|罐|卷|捆|扎|台|把|只|双|副|米|m|M|厘米|cm|CM|平方|平方米|㎡|m2|M2|立方|方|m3|M3|吨|t|T|公斤|kg|KG|斤|车|次|项)$/;
const LINE_ITEM_NOISE =
  /(品名|规格|单位|数量|单价|金额|合计|小计|总计|大写|备注|客户|需方|供方|送货单|销售单|出货单|销货|地址|电话|传真|经手|签收|收货|审核|制单|日期|单号|编号|页码)/;
const SERVICE_ITEM_RE = /(运费|车费|跑腿|搬运|吊装|叉车|管理费|服务费|人工|安装费|维修费|加工费|租金|邮费|快递|配送)/;

function toHalfWidth(s) {
  return String(s || "").replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function cleanItemLine(raw) {
  return toHalfWidth(raw)
    .replace(/<[^>]+>/g, "")
    .replace(/[|,，;；]/g, " ")
    .replace(/[：:]/g, " ")
    .replace(/^[\s\-–—]*\d+[\).、）]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toNumToken(token) {
  const s = String(token ?? "")
    .replace(/[¥￥元块]/g, "")
    .replace(/[,，]/g, "")
    .trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function numberInfo(token) {
  const value = toNumToken(token);
  if (value == null) return null;
  return { value, money: /[¥￥元块]/.test(String(token)) };
}

function quantityUnitToken(token) {
  const m = String(token || "").match(/^(-?\d+(?:\.\d+)?)(.+)$/);
  if (!m || !UNIT_IN_TOKEN_RE.test(m[2])) return null;
  return { quantity: Number(m[1]), unit: m[2] };
}

function normalizeItemName(tokens) {
  const nameTokens = [...tokens];
  if (nameTokens.length > 1 && /^\d{1,3}$/.test(nameTokens[0])) nameTokens.shift();
  return nameTokens
    .join(" ")
    .replace(/^[\s\-–—]*\d+[\).、）]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function autoTotal(quantity, unitPrice) {
  const q = Number(quantity);
  const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return "";
  return Math.round(q * p * 100) / 100;
}

function likelyItemName(name) {
  if (!name || name.length > 60) return false;
  if (!/[一-龥A-Za-z]/.test(name)) return false;
  if (LINE_ITEM_NOISE.test(name)) return false;
  if (COMPANY_HINTS.test(name.replace(/\s+/g, ""))) return false;
  return true;
}

function parseTokenizedItem(line) {
  const tokens = cleanItemLine(line).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;

  let unitIndex = -1;
  let unit = "";
  let quantityFromUnit = "";
  for (let i = 0; i < tokens.length; i++) {
    if (UNIT_RE.test(tokens[i])) {
      unitIndex = i;
      unit = tokens[i];
      break;
    }
    const qUnit = quantityUnitToken(tokens[i]);
    if (qUnit && i > 0) {
      unitIndex = i;
      unit = qUnit.unit;
      quantityFromUnit = qUnit.quantity;
      break;
    }
  }

  if (unitIndex < 1) return null;
  const name = normalizeItemName(tokens.slice(0, unitIndex));
  if (!likelyItemName(name)) return null;

  const nums = tokens
    .slice(unitIndex + 1)
    .map(numberInfo)
    .filter(Boolean);
  if (!nums.length && quantityFromUnit === "") return null;

  let quantity = quantityFromUnit;
  let unitPrice = "";
  let total = "";

  if (quantityFromUnit !== "") {
    unitPrice = nums[0]?.value ?? "";
    total = nums[1]?.value ?? "";
  } else if (nums.length === 1 && (nums[0].money || SERVICE_ITEM_RE.test(name))) {
    quantity = 1;
    total = nums[0].value;
    if (!unit || unit === "项") unit = SERVICE_ITEM_RE.test(name) ? "次" : unit;
  } else {
    quantity = nums[0]?.value ?? "";
    unitPrice = nums[1]?.value ?? "";
    total = nums[2]?.value ?? "";
  }

  if (total === "" && quantity !== "" && unitPrice !== "") total = autoTotal(quantity, unitPrice);
  return { name, unit, quantity, unitPrice, total };
}

function trailingNumberItems(tokens) {
  const nums = [];
  let i = tokens.length - 1;
  while (i >= 0) {
    const info = numberInfo(tokens[i]);
    if (!info) break;
    nums.unshift(info);
    i--;
  }
  return { nums, nameTokens: tokens.slice(0, i + 1) };
}

function parseLooseItem(line) {
  const tokens = cleanItemLine(line).split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const { nums, nameTokens } = trailingNumberItems(tokens);
  if (!nums.length) return null;

  let unit = "";
  let quantity = "";
  const lastNameToken = nameTokens[nameTokens.length - 1] || "";
  const qUnit = quantityUnitToken(lastNameToken);
  if (qUnit) {
    unit = qUnit.unit;
    quantity = qUnit.quantity;
    nameTokens.pop();
  }

  const name = normalizeItemName(nameTokens);
  if (!likelyItemName(name)) return null;

  let unitPrice = "";
  let total = "";
  if (quantity !== "") {
    unitPrice = nums[0]?.value ?? "";
    total = nums[1]?.value ?? "";
  } else if (nums.length === 1) {
    if (!nums[0].money && !SERVICE_ITEM_RE.test(name)) return null;
    unit = SERVICE_ITEM_RE.test(name) ? "次" : "";
    quantity = SERVICE_ITEM_RE.test(name) ? 1 : "";
    total = nums[0].value;
  } else {
    quantity = nums[0]?.value ?? "";
    unitPrice = nums[1]?.value ?? "";
    total = nums[2]?.value ?? "";
  }

  if (total === "" && quantity !== "" && unitPrice !== "") total = autoTotal(quantity, unitPrice);
  return { name, unit, quantity, unitPrice, total };
}

// 从“不像标准 Markdown 表格”的 OCR 行里解析材料明细。
// 例：白水泥 包 5 30 150 / 跑腿费 13元 / 镀锌管 6米 12.5 75
export function parseItemLines(lines) {
  const items = [];
  const seen = new Set();
  for (const raw of lines || []) {
    const line = cleanItemLine(raw);
    if (!line) continue;
    if (LINE_ITEM_NOISE.test(line)) continue;
    if (findDate([line]) || findOrderNo([line]) === line.replace(/\s+/g, "")) continue;

    const parsed = parseTokenizedItem(line) || parseLooseItem(line);
    if (!parsed) continue;
    const key = [parsed.name, parsed.unit, parsed.quantity, parsed.unitPrice, parsed.total].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }
  return items;
}

// 候选品名：去掉明显是表头/数字/公司/日期的行，剩下含中文的行作为可点选品名。
const NOISE = /(品名|规格|单位|数量|单价|金额|合计|备注|客户|需方|送货单|销售单|出货单|地址|电话|经手|签收|联系)/;
export function candidateItemNames(lines) {
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (NOISE.test(line)) continue;
    if (COMPANY_HINTS.test(line)) continue;
    if (/^[\d\s.,:：年月日元\-\/]+$/.test(line)) continue; // 纯数字/日期行
    if (!/[一-龥A-Za-z]/.test(line)) continue;
    if (line.length > 30) continue;
    out.push(line);
  }
  return [...new Set(out)];
}

// 综合解析：给一张单的预填值
export function parseDoc(lines) {
  const items = parseItemLines(lines);
  return {
    date: findDate(lines),
    orderNo: findOrderNo(lines),
    company: findCompany(lines),
    items,
    itemCandidates: candidateItemNames(lines),
  };
}

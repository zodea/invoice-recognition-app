// 从 OCR 文本行里“尽力”抽取 日期 / 单号 / 公司 / 候选品名。
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

// 识别单号：优先“单号/编号/No”后面的串，否则取最长的一串 6+ 位数字/字母。
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
  return best || "";
}

// 识别公司名：含“有限公司/经营部/商行/厂/贸易/电缆/建材”等关键词的最长行。
const COMPANY_HINTS = /(有限公司|有限责任公司|经营部|商行|商贸|贸易|建材|电缆|照明|装饰|设备|厂|店)/;
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
  return {
    date: findDate(lines),
    orderNo: findOrderNo(lines),
    company: findCompany(lines),
    itemCandidates: candidateItemNames(lines),
  };
}

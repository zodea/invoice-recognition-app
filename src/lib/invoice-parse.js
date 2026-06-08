// 从发票文本（电子发票抽到的文字，或扫描件 OCR 的文字）里尽力抽取关键字段。
// 中国增值税发票/数电票字段：发票号码、开票日期、购/销方、金额、税额、价税合计。
// 识别不可能 100% 准，最终以人工核对为准。

function pad2(n) {
  return String(n).padStart(2, "0");
}
function toNumber(s) {
  if (s == null) return "";
  const n = Number(String(s).replace(/[,，\s¥￥]/g, ""));
  return Number.isFinite(n) ? n : "";
}
function normalizeMoneyText(s) {
  return String(s || "").replace(/[\s,，]/g, "");
}

function cleanRemark(s) {
  return String(s || "")
    .replace(/^[\s:：]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractRemark(text) {
  const lines = String(text || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const stop = /^(购买方|销售方|购\s|销\s|合\s*计|价税合计|开票人|复核|收款人|发票号码|开票日期|项目名称|名\s*称|统一社会|纳税人)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/备\s*注[:：]?\s*(.*)$/);
    if (!m) continue;
    const parts = [];
    const first = cleanRemark(m[1]);
    if (first && !stop.test(first)) parts.push(first);
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (stop.test(lines[j])) break;
      parts.push(cleanRemark(lines[j]));
    }
    return parts.filter(Boolean).join(" ");
  }
  return "";
}

// 个别电子发票字体把汉字映射成「CJK 部首补充区」的部首字形（NFKC 不会归一），
// 抽出来就成了 ⻨/⻝ 这类怪字。这里按观察到的做点对点修正（如需可继续补充）。
const RADICAL_FIX = { "⻨": "麦", "⻝": "食", "⻆": "角", "⻔": "门", "⻢": "马", "⻅": "见" };

// 粗分单据大类：报销时混在一起的几种件。返回固定枚举，供 UI/Excel/重命名按类区分处理。
export function classifyDocType(rawText) {
  const t = String(rawText || "");
  // 先认行程单/货运凭证：它们文里也常出现“电子发票”字样（如“请以电子发票金额为准”），
  // 必须在“增值税发票”之前判断，否则会被误判成发票。
  if (/行程单/.test(t)) return "行程单";
  if (/货物运输|货拉拉|收款凭证|托运人/.test(t)) return "货物运输凭证";
  if (/发票|价税合计|开票日期|税额/.test(t)) return "增值税发票";
  return "未识别";
}

export function parseInvoice(rawText) {
  // NFKC 归一：全角→半角、兼容字符（兼容冒号/￥/数字、康熙部首⼴→广 等）统一，
  // 显著提升“开票日期/价税合计/名称”等字段的命中率（如麦当劳那张日期原本抽不到）。
  let text = String(rawText || "").normalize("NFKC");
  for (const [k, v] of Object.entries(RADICAL_FIX)) if (text.includes(k)) text = text.split(k).join(v);
  text = text.replace(/[ \t]+/g, " ");
  const f = { code: "", number: "", date: "", dateText: "", buyer: "", seller: "", amount: "", tax: "", total: "", rate: "", type: "", taxKind: "", docType: "", remark: "", service: "", category: "" };

  // 单据大类（发票 / 行程单 / 货物运输凭证 / 未识别），按原始文本判定一次
  f.docType = classifyDocType(rawText);

  // 发票类型
  const tMatch = text.match(/(电子发票|增值税电子专用发票|增值税电子普通发票|增值税专用发票|增值税普通发票|普通发票|专用发票|数电)/);
  if (tMatch) f.type = tMatch[1];

  // 专票/普票判定（分目录“发票类型”用）：很多票 type 抽成笼统“电子发票”，
  // 但括注/全称里有“专用发票/普通发票”，据此给出更准的专票/普票分类。
  if (/专用发票/.test(text)) f.taxKind = "专用发票";
  else if (/普通发票/.test(text)) f.taxKind = "普通发票";

  // 发票号码（数电 20 位；旧版 8 位）
  const num = text.match(/发\s*票\s*号\s*码[:：]?\s*([0-9]{8,25})/) ||
    text.match(/票\s*据\s*号\s*码[:：]?\s*([0-9]{8,25})/);
  if (num) f.number = num[1];
  const code = text.match(/发\s*票\s*代\s*码[:：]?\s*([0-9]{10,12})/);
  if (code) f.code = code[1];
  // 没匹配到“发票号码”标签时，兜底找一串 20 位数字
  if (!f.number) {
    const bare = text.match(/\b([0-9]{20})\b/);
    if (bare) f.number = bare[1];
  }

  // 开票日期
  const d = text.match(/开票日期[:：]?\s*([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日/) ||
    text.match(/([0-9]{4})\s*年\s*([0-9]{1,2})\s*月\s*([0-9]{1,2})\s*日/);
  if (d) {
    f.date = `${d[1]}-${pad2(+d[2])}-${pad2(+d[3])}`;
    f.dateText = f.date;
  }
  if (!f.date) {
    const spacedDate = text.match(/([0-9](?:\s*[0-9]){3})\s*年\s*([0-9](?:\s*[0-9])?)\s*月\s*([0-9](?:\s*[0-9])?)\s*日/);
    if (spacedDate) {
      const y = normalizeMoneyText(spacedDate[1]);
      const mo = normalizeMoneyText(spacedDate[2]);
      const day = normalizeMoneyText(spacedDate[3]);
      f.date = `${y}-${pad2(+mo)}-${pad2(+day)}`;
      f.dateText = f.date;
    }
  }

  // 名称（购买方、销售方）。两种常见版式：
  //   数电票：「购 名称：买方 … 销 名称：卖方」(购在前、销在后)
  //   旧版/增普：「购买方信息  销售方信息」一行，「名称：买方  名称：卖方」在下一行
  // 取「名称：」后到下一个分界（下一个名称：/统一社会/纳税人/行尾）为止的整段，再去空白，
  // 既能正确切分买卖方（不会并到一起），又不会因公司名里夹了空格而被截断（如专票“永康市 锦霸…”）。
  const cleanName = (s) =>
    String(s)
      .replace(/[\x00-\x1f]/g, "") // 去掉混淆字体抽出的控制字符（如 \x00）
      .replace(/\s+/g, "")
      .replace(/^(名称|信息|购|销|买|售|[:：])+/g, "")
      .replace(/(名称|信息|买方|售方|购|销|买|售|方|[:：])+$/g, "") // 含被并进来的对方标签字（买/售/销）
      .trim();
  // 个别发票字体把每个字重复一遍，抽出来成「佛佛山山美美的的…」。仅当整串都是相同字成对时折叠。
  const dedupeDoubled = (s) => {
    if (s.length >= 4 && s.length % 2 === 0) {
      for (let i = 0; i < s.length; i += 2) if (s[i] !== s[i + 1]) return s;
      return s.replace(/(.)\1/g, "$1");
    }
    return s;
  };
  // 公司名必须含中文（排除混淆字体抽出的乱码/控制字符串），长度 2~40 且非纯数字
  const isName = (s) => s && s.length >= 2 && s.length <= 40 && !/^\d+$/.test(s) && /[一-龥]/.test(s);
  // 冒号后只吃“同一行”的水平空白（不能吃换行）——否则像中石化「名称: 名称:」下一行是
  // 「买 售」，\s* 会跨行把“买 售”当成名称抽出来变成“买售”。
  const nameTokens = [...text.matchAll(/名\s*称\s*[:：][^\S\n]*([^\n]*?)(?=名\s*称\s*[:：]|统一社会|纳税人|项目名称|托运人|证照|地\s*址|开户|\n|$)/g)]
    .map((m) => dedupeDoubled(cleanName(m[1])))
    .filter(isName);
  if (nameTokens[0]) f.buyer = nameTokens[0];
  if (nameTokens[1]) f.seller = nameTokens[1];
  // 兜底：没有“名称：”标签时，用 购/销 两字切分（少数版式名称紧跟在购/销后）
  if (!f.buyer || !f.seller) {
    const gx = text.match(/购\s*(?:名\s*称\s*[:：]\s*)?(.+?)\s*销\s*(?:名\s*称\s*[:：]\s*)?(.+)/);
    if (gx) {
      const b = dedupeDoubled(cleanName(gx[1]));
      const s = dedupeDoubled(cleanName(gx[2]));
      if (!f.buyer && isName(b)) f.buyer = b;
      if (!f.seller && isName(s)) f.seller = s;
    }
  }
  if (!f.buyer) {
    const b = text.match(/(?:购买方|买方|付款方)[\s\S]{0,20}?名\s*称\s*[:：]?\s*([^\n]+)/);
    if (b) {
      const name = dedupeDoubled(cleanName(b[1]));
      if (isName(name)) f.buyer = name;
    }
  }
  if (!f.seller) {
    const s = text.match(/(?:销售方|卖方|收款方)[\s\S]{0,20}?名\s*称\s*[:：]?\s*([^\n]+)/);
    if (s) {
      const name = dedupeDoubled(cleanName(s[1]));
      if (isName(name)) f.seller = name;
    }
  }

  // 价税合计（小写）
  const total =
    text.match(/价税合计[\s\S]{0,40}?[（(]?小写[）)]?\s*[¥￥]?\s*([0-9,]+\.[0-9]{2})/) ||
    text.match(/[（(]小写[）)]\s*[¥￥]?\s*([0-9,]+\.[0-9]{2})/) ||
    text.match(/价税合计[\s\S]{0,20}?[¥￥]\s*([0-9,]+\.[0-9]{2})/);
  if (total) f.total = toNumber(total[1]);
  if (f.total === "") {
    const m = text.match(/小写[)）]?\s*[:：]?\s*[¥￥]?\s*([0-9,]+\.[0-9]{2})/);
    if (m) f.total = toNumber(m[1]);
  }

  // 部分增值税专用发票把每个字符单独定位，抽出来成「¥ 2 0 . 5 2」。上面的连续数字正则抽不到，
  // 这里加“字符间含空格”的兜底（仅限金额/逗号/小数点，不跨行，避免误并相邻列）。
  const despace = (s) => s.replace(/[\s,]/g, "");
  if (f.total === "") {
    const m = text.match(/小写[)）]?\s*[¥￥]\s*([0-9][0-9 ,]*\.[0-9 ]*[0-9])/);
    if (m) f.total = toNumber(despace(m[1]));
  }

  // 合计 金额 + 税额（常见一行：合计 ¥金额 ¥税额）
  const sum =
    text.match(/合\s*计\s*[¥￥]\s*([0-9,]+\.[0-9]{2})\s*[¥￥]\s*([0-9,]+\.[0-9]{2})/) ||
    text.match(/合\s*计\s*[¥￥]\s*([0-9][0-9 ,]*\.[0-9 ]*[0-9])\s*[¥￥]\s*([0-9][0-9 ,]*\.[0-9 ]*[0-9])/);
  if (sum) {
    f.amount = toNumber(despace(sum[1]));
    f.tax = toNumber(despace(sum[2]));
  }
  if (!sum) {
    const plainSum = text.match(/合\s*计\s+([+-]?[0-9][0-9, ]*\.[0-9 ]*[0-9])\s+([+-]?[0-9][0-9, ]*\.[0-9 ]*[0-9])/);
    if (plainSum) {
      f.amount = toNumber(despace(plainSum[1]));
      f.tax = toNumber(despace(plainSum[2]));
    }
  }
  // 单独的税额
  if (f.tax === "") {
    const taxM = text.match(/税\s*额[\s\S]{0,10}?[¥￥]\s*([0-9,]+\.[0-9]{2})/) ||
      text.match(/税\s*额[:：]?\s*([0-9,]+\.[0-9]{2})/);
    if (taxM) f.tax = toNumber(taxM[1]);
  }
  // 金额 = 价税合计 - 税额（兜底）
  if (f.amount === "" && f.total !== "" && f.tax !== "") {
    f.amount = Math.round((Number(f.total) - Number(f.tax)) * 100) / 100;
  }

  // 税点（税率/征收率）：收集表体各行的税率，去重——只有一种税率才填入；
  // 出现多种不同税率（混票）则留空，由人工填写（按需求）。仅认常见增值税税率/征收率，
  // 避免把规格型号里的「95%」等无关百分数误当税率。
  const KNOWN_RATES = new Set(["0", "1", "1.5", "2", "3", "4", "5", "6", "9", "10", "11", "13", "16", "17"]);
  const rateSet = new Set();
  for (const m of text.matchAll(/([0-9]{1,2}(?:\.[0-9])?)\s*%/g)) {
    if (KNOWN_RATES.has(m[1])) rateSet.add(m[1]);
  }
  if (rateSet.size === 1) f.rate = [...rateSet][0] + "%";
  f.remark = extractRemark(text);

  // 劳务、服务名称 + 税收大类。中国发票项目名格式为「*税收分类*具体名称」，
  // 首对星号里的就是天然的“大类统称词”（餐饮服务/汽油/企业管理服务…），用于费用报销归纳。
  // 仅匹配“纯中文”的税收分类，避免脱敏星号（如 何* / 45222919****817）被误当成 *类别*
  const catM = text.match(/\*\s*([一-龥][一-龥·]{0,23})\s*\*/);
  if (catM) f.category = catM[1].replace(/\s+/g, "").trim();
  const itemM = text.match(/\*\s*[一-龥][一-龥·]{0,23}\s*\*\s*([^\n]+)/);
  if (itemM) {
    // 砍掉规格/单位/数量/单价等尾部（从第一个独立数字或 ¥ 起）
    let s = itemM[1].replace(/\s+/g, " ").trim();
    s = s.replace(/\s+(?=\d|[¥￥])\S.*$/, "").trim();
    s = s.replace(/[\d¥￥%].*$/, "").trim();
    if (s && /[一-龥]/.test(s)) f.service = s;
  }
  if (!f.service) f.service = f.category;

  // 非增值税发票但报销常混进来的两类凭证：
  //   ① 网约车行程单（曹操/滴滴/优行/如约）：「合计X元」+「申请日期/行程时间」。
  //   ② 货拉拉等货物运输电子收款凭证：「费用合计(大写)…(小写)：¥X」+「申请日期」，购买方=托运人。
  // 销售方/承运人多为个人或在另开发票上，难可靠取得，留空由调用方按文件名/目录补。
  if (/行程单|货物运输|货拉拉|收款凭证/.test(text)) {
    if (!f.type || f.type === "电子发票") f.type = /行程单/.test(text) ? "行程单" : "货物运输凭证";
    if (f.total === "") {
      const m =
        text.match(/[合总]\s*计[^0-9]{0,6}([0-9,]+\.[0-9]{2})\s*元?/) || // 合计/总计 X[元]（货拉拉行程单是“总计”）
        text.match(/小写[)）]?\s*[:：]?\s*[¥￥]\s*([0-9,]+\.[0-9]{2})/) ||
        text.match(/[¥￥]\s*([0-9,]+\.[0-9]{2})/); // 最后兜底：任意 ¥金额
      if (m) f.total = toNumber(m[1]);
    }
    if (!f.date) {
      const dm =
        text.match(/申请日期[:：]?\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})/) ||
        text.match(/行程时间[:：]?\s*([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})/);
      if (dm) { f.date = `${dm[1]}-${pad2(+dm[2])}-${pad2(+dm[3])}`; f.dateText = f.date; }
    }
    if (!f.buyer) {
      // 托运人名称（货物运输凭证） / 公司:（货拉拉行程单抬头单位）都视为购买方
      const bm =
        text.match(/托运人名称[:：]?\s*([^\n]+?)(?=托运人证照|证照号码|$)/) ||
        text.match(/公\s*司\s*[:：]\s*([^\n,，]+?)(?=\s*共|\s*[0-9]|\n|$)/);
      if (bm) {
        const name = dedupeDoubled(cleanName(bm[1]));
        if (isName(name)) f.buyer = name;
      }
    }
    // 行程单/货运凭证无税收分类，归到固定运输大类（避免抓到脱敏文字当大类）
    if (!f.category || !/^[一-龥·]+$/.test(f.category)) f.category = /行程单/.test(text) ? "交通运输" : "运输服务";
    if (!f.service || !/[一-龥]/.test(f.service)) f.service = f.category;
  }

  return f;
}

export function isProbablyInvoiceText(text) {
  // 先去掉字符间空格再判：有的混淆票把每个字拆开成“电 子 发 票”，连写关键词会匹配不到，
  // 导致被误当扫描件走 OCR、丢失本可抽到的买卖方。去空格后这类票也能正确进入文字解析。
  const t = String(text || "").replace(/[ \t]+/g, "");
  return /发票|价税合计|开票日期|税额|行程单|货物运输|货拉拉|收款凭证|托运人/.test(t);
}

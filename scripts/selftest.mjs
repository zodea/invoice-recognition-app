// 无浏览器自检：验证纯 JS 的命名 / 解析 / Excel 生成逻辑。
// 运行：node scripts/selftest.mjs
import assert from "node:assert";
import fs from "node:fs";
import * as XLSX from "xlsx";
import { dateRangeLabel, archiveBaseName, safeSheetName } from "../src/lib/naming.js";
import { parseDoc, findDate, findOrderNo, findCompany } from "../src/lib/parse.js";
import { buildWorkbookBytes } from "../src/lib/excel.js";
import { parseInvoice, classifyDocType, isProbablyInvoiceText } from "../src/lib/invoice-parse.js";
import { buildInvoiceWorkbookBytes } from "../src/lib/invoice-excel.js";
import { exportWorkbookName, invoiceExportFileName, exportParentFolderName, invoiceFolderParts } from "../src/lib/invoice-export-package.js";
import { buildPrintLayout } from "../src/lib/invoice-layout.js";
import { applyInvoiceFilenameFallback, parseInvoiceFilename } from "../src/lib/invoice-filename.js";
import { isDuplicateInvoice, markInvoiceDuplicates } from "../src/lib/invoice-dedupe.js";
import { bigCategory, classifyReimburseKind, buildReimburseWorkbookBytes } from "../src/lib/invoice-reimburse.js";
import { buildCurrentInputInvoiceReportBytes, buildHistoryReportBytes, historyStatus, importInputInvoiceRows, importInputInvoiceWorkbookBytes, ledgerStats, markPrintedInvoices, parseInputInvoiceRows, shouldDefaultExcludeByHistory } from "../src/lib/invoice-ledger.js";
import { PDFDocument } from "pdf-lib";

let pass = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  console.log("  ✓", name);
  pass++;
}

console.log("== naming ==");
ok("单天", dateRangeLabel(["2026-05-10"]) === "2026-05-10");
ok("跨天", dateRangeLabel(["2026-03-26", "2026-03-28"]) === "2026-03-26~03-28");
ok("全未知", dateRangeLabel([null, null]) === "日期待复核");
ok("部分未知", dateRangeLabel(["2026-03-26", null]).startsWith("2026-03-26"));
ok(
  "归档名",
  archiveBaseName("广州骏丰装饰建材有限公司", ["2026-02-03", "2026-06-02"], 21) ===
    "广州骏丰装饰建材有限公司-2026-02-03~06-02-送货单21张"
);
ok("工作表名截断", safeSheetName("a".repeat(40)).length === 31);

console.log("== parse ==");
const lines = [
  "广州富丰建材贸易有限公司",
  "客户(需方): 赵恩师  2026年3月9日",
  "单号: 0005864",
  "电线辅筋扎丝 盒 1 30元 30元",
  "跑腿费 13元",
];
ok("日期", findDate(lines) === "2026-03-09");
ok("单号", findOrderNo(lines) === "0005864");
ok("公司", findCompany(lines) === "广州富丰建材贸易有限公司");
const parsed = parseDoc(lines);
ok("候选品名含扎丝", parsed.itemCandidates.some((s) => s.includes("扎丝")));

console.log("== excel ==");
const files = [
  {
    company: "广州富丰建材贸易有限公司",
    merge: true,
    note: "",
    docs: [
      {
        date: "2026-03-09",
        dateText: "2026-03-09",
        orderNo: "0005864",
        _source: "广州富丰建材贸易有限公司-2026-03-09-送货单1张.pdf",
        items: [
          { name: "电线辅筋扎丝", unit: "盒", quantity: 1, unitPrice: 30, total: 30 },
          { name: "跑腿费", unit: "次", quantity: 1, unitPrice: 13, total: 13 },
        ],
      },
    ],
  },
  {
    company: "花城珠江电线电缆（无章按材料分类）",
    merge: false,
    note: "无公司章，按材料分类",
    docs: [
      {
        date: null,
        dateText: "日期待复核",
        orderNo: "XF-202603010-01",
        _source: "花城珠江电线电缆（无章按材料分类）-日期待复核-送货单1张.pdf",
        items: [{ name: "花城珠江 ZC-YJV 3*4", unit: "米", quantity: 200, unitPrice: "", total: "" }],
      },
    ],
  },
];
const bytes = buildWorkbookBytes(files);
const out = "scripts/_selftest.xlsx";
fs.writeFileSync(out, Buffer.from(bytes));
const wb = XLSX.read(fs.readFileSync(out));
ok("含富丰工作表", wb.SheetNames.includes("广州富丰建材贸易有限公司"));
ok("含待复核清单", wb.SheetNames.includes("待复核清单"));
const ws = wb.Sheets["广州富丰建材贸易有限公司"];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
ok("表头正确", rows[0][0] === "日期" && rows[0][2] === "材料名称" && rows[0][5] === "总价");
ok("数据行-扎丝", rows.some((r) => r[2] === "电线辅筋扎丝" && r[5] === 30));
ok("无章件进了待复核", XLSX.utils.sheet_to_json(wb.Sheets["待复核清单"], { header: 1 }).some((r) => String(r[3]).includes("无公司章")));
fs.unlinkSync(out);

console.log("== invoice parse ==");
const invText = [
  "电子发票（普通发票）",
  "发票号码：25312000000123456789",
  "开票日期：2026年03月09日",
  "购买方信息 名称：广州测试建筑有限公司",
  "销售方信息 名称：广州富丰建材贸易有限公司",
  "合计 ¥283.02 ¥16.98",
  "价税合计（大写）叁佰元整 （小写）¥300.00",
].join("\n");
const pinv = parseInvoice(invText);
ok("发票号码", pinv.number === "25312000000123456789");
ok("开票日期", pinv.date === "2026-03-09");
ok("销售方", pinv.seller.includes("富丰"));
ok("价税合计=300", Number(pinv.total) === 300);
ok("税额=16.98", Number(pinv.tax) === 16.98);
ok("金额=283.02", Number(pinv.amount) === 283.02);
ok("parseInvoice 带 docType=增值税发票", pinv.docType === "增值税发票");

const spacedLabels = parseInvoice([
  "发 票 号 码： 25312000000999998888",
  "开票日期: 2 0 2 6 年 0 5 月 0 8 日",
  "销售方 名称：杭州测试商行",
  "购买方 名称：广州测试建筑有限公司",
  "合 计 283.02 16.98",
  "价税合计（大写）叁佰元整 （小写）300.00",
  "备注：项目A报销",
].join("\n"));
ok("空格发票号码", spacedLabels.number === "25312000000999998888");
ok("空格开票日期", spacedLabels.date === "2026-05-08");
ok("无币符号合计金额", Number(spacedLabels.amount) === 283.02);
ok("无币符号合计税额", Number(spacedLabels.tax) === 16.98);
ok("无币符号小写价税合计", Number(spacedLabels.total) === 300);
ok("票面备注", spacedLabels.remark === "项目A报销");

console.log("== 税点（税率/征收率）==");
// 单一税率 13%（规格里的 95 号不带 % 不应误判）
const rate13 = parseInvoice([
  "项目名称 规格型号 单 位 数 量 单 价 金 额 税率/征收率 税 额",
  "*汽油*95号车用汽油 升 61.65 6.45 397.72 13% 51.70",
].join("\n"));
ok("单一税率 -> 13%", rate13.rate === "13%");
// 同一发票多行同税率（含红冲负行）6% -> 仍算一种
const rate6 = parseInvoice([
  "金 额 税率/征收率 税 额",
  "*餐饮服务*餐费 431.13 6% 25.87",
  "*餐饮服务*餐费 -133.65 6% -8.02",
].join("\n"));
ok("多行同税率 -> 6%", rate6.rate === "6%");
// 混票：多种不同税率 -> 留空
const rateMixed = parseInvoice([
  "金 额 税率/征收率 税 额",
  "*货物*A 100.00 13% 13.00",
  "*服务*B 50.00 6% 3.00",
].join("\n"));
ok("多种税率混票 -> 留空", rateMixed.rate === "");
// 无税率（如免税/不征税，文本无 %）-> 留空
ok("无税率 -> 留空", parseInvoice("价税合计（小写）¥300.00 免税").rate === "");

console.log("== invoice filename fallback ==");
const byName = parseInvoiceFilename("260120_980.00_比音勒芬服饰股份有限公司广州海珠第一分公司.pdf");
ok("文件名兜底 日期=2026-01-20", byName.date === "2026-01-20");
ok("文件名兜底 金额=980.00", byName.total === "980.00");
ok("文件名兜底 销售方=比音勒芬", byName.seller.includes("比音勒芬"));
const fieldsByName = { number: "", date: "", dateText: "", seller: "", total: "", type: "" };
const filledByName = applyInvoiceFilenameFallback(fieldsByName, "dzfp_26512000000397340296_西充县古楼农机加油站_20260212150613.pdf");
ok("dzfp 文件名兜底号码", fieldsByName.number === "26512000000397340296");
ok("dzfp 文件名兜底销售方", fieldsByName.seller === "西充县古楼农机加油站");
ok("文件名兜底返回填充字段", filledByName.filled.includes("number") && filledByName.filled.includes("seller"));

console.log("== invoice duplicate detection ==");
const dupA = {
  id: "a",
  name: "a.pdf",
  include: true,
  fields: {
    number: "25312000000111111111",
    date: "2026-05-08",
    seller: "杭州测试商行",
    buyer: "广州测试建筑有限公司",
    amount: 283.02,
    tax: 16.98,
    total: 300,
    docType: "增值税发票",
    remark: "项目A",
  },
};
const dupB = {
  id: "b",
  name: "b.pdf",
  include: true,
  fields: { ...dupA.fields },
};
ok("日期和票面内容一致 -> 重复", isDuplicateInvoice(dupB, dupA));
const duplicateCount = markInvoiceDuplicates([dupA, dupB]);
ok("重复项自动排除", duplicateCount === 1 && dupA.include === true && dupB.include === false && dupB.duplicateReason.includes("疑似重复"));
const sameNumberDifferentContent = {
  id: "c",
  name: "c.pdf",
  include: true,
  fields: {
    ...dupA.fields,
    total: 301,
    amount: 284.02,
  },
};
ok("日期和发票号码一致但内容不同 -> 不去重", !isDuplicateInvoice(sameNumberDifferentContent, dupA));

console.log("== 单据类型分类 classifyDocType ==");
ok("普通增值税发票 -> 增值税发票", classifyDocType("电子发票（普通发票） 发票号码：123 价税合计（小写）¥300.00") === "增值税发票");
ok("网约车行程单 -> 行程单(即便含'电子发票'字样)", classifyDocType("腾讯出行服务—打车——行程单 合计67.75元 实际报销金额请以电子发票金额为准") === "行程单");
ok("货拉拉货运凭证 -> 货物运输凭证", classifyDocType("货物运输电子收款凭证 电子收款凭证号:015743037 托运人名称: 广东瑞航建设工程有限公司 费用合计(大写) (小写): ¥ 53.37") === "货物运输凭证");
ok("空白/乱码 -> 未识别", classifyDocType("   \n  ") === "未识别");

console.log("== 发票字段修复（回归，按版式）==");
// 中石化版式：购/销 名在上行，「名称:」标签独占下一行，再下一行是「买 售」。
// 历史 bug：冒号后的 \s* 跨行把「买 售」抓成 buyer=「买售」。
const sinopec = parseInvoice([
  "购 广州力沣建筑劳务有限公司 销 中国石化销售股份有限公司广东广州石油分公司",
  "名称: 名称:",
  "买 售",
  "开票日期：2026年03月29日",
  "价税合计（小写）¥390.26",
].join("\n"));
ok("中石化版式 买方=力沣(不再是'买售')", sinopec.buyer === "广州力沣建筑劳务有限公司");
ok("中石化版式 卖方=中石化", sinopec.seller.startsWith("中国石化销售股份有限公司"));

// 「买 名称:A 售 名称:B」单行：历史 bug：买方把对方的「售」标签也括进来 -> 「…公司售」。
const oneLine = parseInvoice("购 销\n买 名称: 广东瑞航建设工程有限公司 售 名称: 广州市冠晖物业管理有限公司\n开票日期：2026年05月23日");
ok("单行买卖方 买方无尾随'售'", oneLine.buyer === "广东瑞航建设工程有限公司");
ok("单行买卖方 卖方=冠晖", oneLine.seller === "广州市冠晖物业管理有限公司");

// 重复字混淆：佛佛山山… -> 折叠成正常名。
const doubled = parseInvoice("购 名称: 广广东东瑞瑞航航建建设设工工程程有有限限公公司司 销 名称: 佛佛山山美美的的智智慧慧家家居居有有限限公公司司\n开票日期：2026年04月11日");
ok("重复字混淆 买方折叠", doubled.buyer === "广东瑞航建设工程有限公司");
ok("重复字混淆 卖方折叠", doubled.seller === "佛山美的智慧家居有限公司");

// 部首字形：⻨/⻝ -> 麦/食。
const radical = parseInvoice("购 名称: 广东瑞航建设工程有限公司 销 名称: 广东三元⻨当劳⻝品有限公司\n开票日期：2026年04月22日");
ok("部首字形 卖方=麦当劳食品", radical.seller === "广东三元麦当劳食品有限公司");

// 字符间距专票：金额抽成「2 0 . 5 2」也要能识别。
const spaced = parseInvoice("开票日期: 2 0 2 6 年0 4 月1 1 日\n价税合计(大写) 贰拾圆伍角贰分 (小写) ¥ 2 0 . 5 2");
ok("字符间距专票 价税合计=20.52", Number(spaced.total) === 20.52);

// 行程单（网约车）：取申请日期 + 合计金额，类型=行程单。
const trip = parseInvoice([
  "腾讯出行服务—打车——行程单",
  "申请日期：2026-05-15 17:58:38 行程时间：2026-01-27 12:58 至 2026-01-27 13:36",
  "共1个行程，合计67.75元",
].join("\n"));
ok("行程单 docType=行程单", trip.docType === "行程单");
ok("行程单 type=行程单", trip.type === "行程单");
ok("行程单 取申请日期=2026-05-15", trip.date === "2026-05-15");
ok("行程单 合计金额=67.75", Number(trip.total) === 67.75);

// 货拉拉货物运输电子收款凭证：买方=托运人(不含证照号码)，金额取(小写)，日期取申请日期。
const freight = parseInvoice([
  "货物运输电子收款凭证",
  "申请日期: 2026-03-24 17:43",
  "托运人名称: 广东瑞航建设工程有限公司 托运人证照号码: 91440101MA9XPYYU4M",
  "费用合计(大写) 伍拾叁元叁角柒分 (小写): ¥ 53.37",
].join("\n"));
ok("货运凭证 docType=货物运输凭证", freight.docType === "货物运输凭证");
ok("货运凭证 type=货物运输凭证", freight.type === "货物运输凭证");
ok("货运凭证 买方=托运人(无证照号码)", freight.buyer === "广东瑞航建设工程有限公司");
ok("货运凭证 金额=53.37", Number(freight.total) === 53.37);
ok("货运凭证 日期=2026-03-24", freight.date === "2026-03-24");
// 货运凭证/行程单没有“发票/价税合计”字样，但必须被判定为“可走文字解析”，否则会被当扫描件去 OCR
ok("isProbablyInvoiceText 认货运凭证", isProbablyInvoiceText("货物运输电子收款凭证 托运人名称: x 费用合计(大写) (小写): ¥ 53.37"));
ok("isProbablyInvoiceText 认行程单", isProbablyInvoiceText("腾讯出行服务—打车——行程单 合计67.75元"));
ok("isProbablyInvoiceText 普通文本=false", !isProbablyInvoiceText("这是一段普通文字"));
ok("专票普票 taxKind 普通", parseInvoice("电子发票(普通发票) 开票日期：2026年04月22日").taxKind === "普通发票");
ok("专票普票 taxKind 专用", parseInvoice("增值税专用发票 开票日期：2026年04月11日").taxKind === "专用发票");
// 货拉拉“行程单”版式：买方写在“公司:”，金额写成“总计X元”
const hll2 = parseInvoice("货拉拉行程单\n公司:广东瑞航建设工程有限公司 共 1 条用车记录,总计53.37元\n申请日期:2026-03-24 17:43:28");
ok("货拉拉行程单 买方=公司抬头", hll2.buyer === "广东瑞航建设工程有限公司");
ok("货拉拉行程单 总计=53.37", Number(hll2.total) === 53.37);
ok("货拉拉行程单 日期=2026-03-24", hll2.date === "2026-03-24");
// 逐字拆开的混淆票：去空格后仍应判为可走文字解析
ok("拆字混淆票 isProbablyInvoiceText 容空格", isProbablyInvoiceText("电 子 发 票 ( 普 通 发 票 )"));
// 拆字+重复混淆：买卖方应能抽出（名称容空格 + 去重叠）
const splitDup = parseInvoice("电 子 发 票\n购 销\n买 名 称 : 广 广 东 东 瑞 瑞 航 航 建 建 设 设 工 工 程 程 有 有 限 限 公 公 司 司 售 名 称 : 佛 佛 山 山 美 美 的 的 智 智 慧 慧 家 家 居 居 有 有 限 限 公 公 司 司");
ok("拆字+重复票 卖方=佛山美的", splitDup.seller === "佛山美的智慧家居有限公司");
ok("拆字+重复票 买方=广东瑞航", splitDup.buyer === "广东瑞航建设工程有限公司");
// 劳务服务名称 / 税收大类（*类*）
const itemInv = parseInvoice("项目名称 规格型号 单位 数量\n*餐饮服务*餐饮服务 1 177.64 177.64 6% 10.66\n价税合计（小写）¥188.30");
ok("项目大类=餐饮服务", itemInv.category === "餐饮服务");
const oilInv = parseInvoice("*汽油*国六95#车用汽油 升 47.55 6.47 307.96 13% 40.04\n价税合计（小写）¥348.00");
ok("项目大类=汽油", oilInv.category === "汽油");

console.log("== reimburse ==");
ok("大类-汽油", bigCategory({ fields: { category: "汽油" } }) === "汽油");
ok("大类-电器归日用品", bigCategory({ fields: { category: "家用清洁电器具" } }) === "日用品");
ok("大类-医院归医疗", bigCategory({ fields: { seller: "南方医科大学珠江医院" } }) === "医疗");
ok("分类-专用", classifyReimburseKind({ fields: { taxKind: "专用发票", docType: "增值税发票" } }) === "专用发票");
ok("分类-普通", classifyReimburseKind({ fields: { taxKind: "普通发票", docType: "增值税发票" } }) === "普通发票");
ok("分类-行程单归其他", classifyReimburseKind({ fields: { docType: "行程单" } }) === "其他");
ok("分类-医疗门诊", classifyReimburseKind({ fields: { seller: "中山大学附属第一医院", docType: "增值税发票" } }) === "医疗门诊");
const rinv = [
  { fields: { buyer: "广东瑞航建设工程有限公司", seller: "A加油站", category: "汽油", service: "汽油", taxKind: "普通发票", docType: "增值税发票", total: 100, date: "2026-05-01" } },
  { fields: { buyer: "广东瑞航建设工程有限公司", seller: "B餐厅", category: "餐饮服务", service: "餐饮服务", taxKind: "普通发票", docType: "增值税发票", total: 50, date: "2026-05-02" } },
  { fields: { buyer: "广州市百信装饰工程有限公司", seller: "C公司", category: "日用品", service: "日用品", taxKind: "专用发票", docType: "增值税发票", total: 200, amount: 177, tax: 23, rate: "13%", date: "2026-05-03" } },
];
const rbytes = buildReimburseWorkbookBytes(rinv);
fs.writeFileSync("scripts/_reimb.xlsx", Buffer.from(rbytes));
const rwb = XLSX.read(fs.readFileSync("scripts/_reimb.xlsx"));
ok("报销含瑞航交接单", rwb.SheetNames.some((n) => n.includes("交接单-瑞航")));
ok("报销含百信专票", rwb.SheetNames.some((n) => n.includes("专票-百信")));
const hoSheet = XLSX.utils.sheet_to_json(rwb.Sheets[rwb.SheetNames.find((n) => n.includes("交接单-瑞航"))], { header: 1 });
ok("瑞航交接单合计=150", hoSheet.some((r) => r[0] === "合计" && Number(r[2]) === 150));
fs.unlinkSync("scripts/_reimb.xlsx");

// 字体混淆（ToUnicode 映射成空格/控制字符）：名称应判空，不能抓出乱码。
const obf = parseInvoice("电子发票（普通发票） 发票号码：\n名称：     名称：   \n开票日期：");
ok("字体混淆 买方为空(不抓乱码)", obf.buyer === "");
ok("字体混淆 卖方为空", obf.seller === "");

console.log("== invoice ledger ==");
const taxRows = [
  ["广州力沣建筑劳务有限公司进项发票清单"],
  ["序号", "发票号码", "发票种类", "开票日期", "销方名称", "进项类型", "货物、应税劳务及服务", "不含税金额", "税率", "税额", "有效税额", "加计扣除税额", "价税合计", "红字蓝字", "发票状态"],
  [1, "26447000000704299292", "数电票（普通发票）", "2026-03-29", "中国石化销售股份有限公司广东广州石油分公司", "货物", "*汽油*95号车用汽油(ⅥB)", 483.59, "13%", 62.87, "", "--", 546.46, "蓝字", "正常"],
  [2, "26447000000708374013", "数电票（普通发票）", "2026-03-29", "中国石化销售股份有限公司广东广州石油分公司", "货物", "*汽油*95号车用汽油(ⅥB)", 345.36, "13%", 44.9, "", "--", 390.26, "蓝字", "正常"],
];
const parsedInput = parseInputInvoiceRows(taxRows, { sourceName: "税务局导出.xlsx", importedAt: "2026-06-06" });
ok("进项表导入解析2张", parsedInput.length === 2);
ok("进项表买方取标题公司", parsedInput[0].buyer === "广州力沣建筑劳务有限公司");
ok("进项表默认认证且已打印", parsedInput[0].verified && parsedInput[0].printed);
const importedLedger = importInputInvoiceRows({}, taxRows, { sourceName: "税务局导出.xlsx", importedAt: "2026-06-06" }).ledger;
const ledgerState = historyStatus(importedLedger, { fields: { number: "26447000000704299292" } });
ok("历史状态 usedBefore=true", ledgerState.usedBefore && ledgerState.verified && ledgerState.printed);
ok("历史已打印默认不勾选", shouldDefaultExcludeByHistory(importedLedger, { fields: { number: "26447000000704299292" } }));
ok("台账统计", ledgerStats(importedLedger).total === 2 && ledgerStats(importedLedger).printed === 2);
const fullRows = [
  ["序号", "发票代码", "发票号码", "数电发票号码", "销方名称", "购买方名称", "开票日期", "金额", "税额", "价税合计", "发票票种", "发票状态", "是否正数发票", "货物或应税劳务名称"],
  ["1", "", "", "25322000000640451773", "南京市铂越电子商务有限公司", "广东瑞航建设工程有限公司", "2025-12-31 21:55:28", 86.68, 0.87, 87.55, "数电发票（普通发票）", "正常", "是", "*金属制品*下水器"],
  ["2", "045002200111", "17020885", "--", "广西百祥石油有限公司", "广东瑞航建设工程有限公司", "2025-01-23", 474.05, 61.63, 535.68, "增值税电子普通发票", "正常", "是", ""],
];
const fullParsed = parseInputInvoiceRows(fullRows, { sourceName: "全量发票查询导出结果.xlsx", importedAt: "2026-06-06" });
ok("全量查询格式 数电发票号码识别", fullParsed.length === 2 && fullParsed[0].number === "25322000000640451773");
ok("全量查询格式 发票票种/购买方识别", fullParsed[0].type.includes("普通发票") && fullParsed[0].buyer === "广东瑞航建设工程有限公司");
ok("全量查询格式 数电占位时回退旧号码", fullParsed[1].number === "17020885");
const fullWb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(fullWb, XLSX.utils.aoa_to_sheet([fullRows[0], fullRows[1], fullRows[1]]), "信息汇总表");
XLSX.utils.book_append_sheet(fullWb, XLSX.utils.aoa_to_sheet(fullRows), "发票基础信息");
const fullBytes = XLSX.write(fullWb, { type: "array", bookType: "xlsx" });
ok("全量查询工作簿优先发票基础信息", importInputInvoiceWorkbookBytes({}, fullBytes, { sourceName: "全量" }).imported === 2);
const printedLedger = markPrintedInvoices({}, [{ name: "p.pdf", include: true, fields: { number: "25312000000000000001", date: "2026-05-01", seller: "A公司", buyer: "B公司", total: 100 } }], { name: "测试打印", date: "2026-06-06" }).ledger;
ok("打印后写入台账", historyStatus(printedLedger, { fields: { number: "25312000000000000001" } }).printed);
const hbytes = buildHistoryReportBytes(importedLedger);
fs.writeFileSync("scripts/_history.xlsx", Buffer.from(hbytes));
const hwb = XLSX.read(fs.readFileSync("scripts/_history.xlsx"));
const hrows = XLSX.utils.sheet_to_json(hwb.Sheets["历史发票台账"], { header: 1 });
ok("历史台账导出含已打印列", hrows[0].includes("是否已打印") && hrows.some((r) => r.includes("已打印")));
fs.unlinkSync("scripts/_history.xlsx");
const cbytes = buildCurrentInputInvoiceReportBytes([{ name: "p.pdf", include: true, systemNote: "", fields: { number: "25312000000000000001", date: "2026-05-01", seller: "A公司", buyer: "B公司", total: 100 } }], printedLedger);
fs.writeFileSync("scripts/_current_input.xlsx", Buffer.from(cbytes));
const cwb = XLSX.read(fs.readFileSync("scripts/_current_input.xlsx"));
const crows = XLSX.utils.sheet_to_json(cwb.Sheets["当前进项发票状态"], { header: 1 });
ok("当前进项状态导出含历史已打印", crows[0].includes("历史已打印") && crows.some((r) => r.includes("已打印")));
fs.unlinkSync("scripts/_current_input.xlsx");

console.log("== invoice excel ==");
const invoices = [
  { name: "a.pdf", note: "", include: true, systemNote: "已补录", fields: { number: "123", dateText: "2026-03-09", seller: "广州富丰建材贸易有限公司", buyer: "买方A", amount: 283.02, tax: 16.98, total: 300, rate: "6%", type: "电子发票", remark: "票面A" } },
  { name: "b.pdf", note: "", include: true, fields: { number: "124", dateText: "2026-03-10", seller: "广州富丰建材贸易有限公司", buyer: "买方B", amount: 100, tax: 6, total: 106, type: "电子发票" } },
];
const ibytes = buildInvoiceWorkbookBytes(invoices);
fs.writeFileSync("scripts/_inv.xlsx", Buffer.from(ibytes));
const iwb = XLSX.read(fs.readFileSync("scripts/_inv.xlsx"));
ok("含开票明细表", iwb.SheetNames.includes("开票明细"));
ok("含汇总账单表", iwb.SheetNames.includes("汇总账单"));
const detailSheet = XLSX.utils.sheet_to_json(iwb.Sheets["开票明细"], { header: 1 });
ok("发票 Excel 拆出票面备注/系统备注", detailSheet[0].includes("票面备注") && detailSheet[0].includes("系统备注") && detailSheet.some((r) => r.includes("票面A") && r.includes("已补录")));
const sumSheet = XLSX.utils.sheet_to_json(iwb.Sheets["汇总账单"], { header: 1 });
ok("汇总合计=406", sumSheet.some((r) => r[0] === "合计" && Number(r[4]) === 406));
fs.unlinkSync("scripts/_inv.xlsx");

console.log("== invoice export package ==");
ok("整理导出文件名", invoiceExportFileName(invoices[0]) === "广州富丰建材贸易有限公司：2026-03-09=300.00元.pdf");
ok("整理导出 Excel 根目录名", exportWorkbookName(invoices) === "发票统计_2026-03-09至2026-03-10.xlsx");
// 待优化#2：所有导出物收进一个父文件夹（按开票日期区间命名）
ok("整理导出父文件夹名", exportParentFolderName(invoices) === "发票整理_2026-03-09至2026-03-10");
ok("无日期父文件夹名", exportParentFolderName([{ fields: {} }]) === "发票整理");
// 待优化#3：按所选维度（顺序）生成嵌套文件夹路径
ok("分目录-单维(购买方)", JSON.stringify(invoiceFolderParts(invoices[0], ["buyer"])) === JSON.stringify(["买方A"]));
ok("分目录-多维按序(购买方/日期)", JSON.stringify(invoiceFolderParts(invoices[0], ["buyer", "date"])) === JSON.stringify(["买方A", "2026-03-09"]));
ok("分目录-空维度返回空", invoiceFolderParts(invoices[0], []).length === 0);
const zhuanInv = { fields: { type: "增值税专用发票", docType: "增值税发票" } };
const putongInv = { fields: { type: "增值税普通发票", docType: "增值税发票" } };
ok("分目录-类型专票", JSON.stringify(invoiceFolderParts(zhuanInv, ["type"])) === JSON.stringify(["专用发票"]));
ok("分目录-类型普票", JSON.stringify(invoiceFolderParts(putongInv, ["type"])) === JSON.stringify(["普通发票"]));
ok("分目录-类型行程单", JSON.stringify(invoiceFolderParts({ fields: { docType: "行程单" } }, ["type"])) === JSON.stringify(["行程单"]));
ok("分目录-未识别购买方兜底", JSON.stringify(invoiceFolderParts({ fields: {} }, ["buyer"])) === JSON.stringify(["未识别购买方"]));

console.log("== invoice layout ==");
const srcDoc = await PDFDocument.create();
for (let i = 0; i < 2; i++) {
  const sp = srcDoc.addPage([300, 180]);
  sp.drawRectangle({ x: 10, y: 10, width: 60, height: 40 }); // 给页面加内容，避免空 Contents
}
const srcBytes = await srcDoc.save();
const ab = srcBytes.slice().buffer;
const fakeInv = { name: "inv.pdf", blob: { type: "application/pdf", arrayBuffer: async () => ab } };
const layoutBytes = await buildPrintLayout([fakeInv, fakeInv], { perPage: 2 });
const lwb = await PDFDocument.load(layoutBytes);
ok("排版纸张是A4宽", Math.round(lwb.getPage(0).getWidth()) === 595);
ok("4源页@2每页=2张A4", lwb.getPageCount() === 2);

console.log(`\n全部通过：${pass} 项 ✓`);

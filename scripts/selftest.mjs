// 无浏览器自检：验证纯 JS 的命名 / 解析 / Excel 生成逻辑。
// 运行：node scripts/selftest.mjs
import assert from "node:assert";
import fs from "node:fs";
import * as XLSX from "xlsx";
import { dateRangeLabel, archiveBaseName, safeSheetName } from "../src/lib/naming.js";
import { parseDoc, findDate, findOrderNo, findCompany, parseItemLines } from "../src/lib/parse.js";
import { parseVlToDocs, pickSupplier } from "../src/lib/vl-parse.js";
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
ok("散行明细：扎丝", parsed.items.some((it) => it.name.includes("扎丝") && it.unit === "盒" && it.quantity === 1 && it.unitPrice === 30 && it.total === 30));
const looseItems = parseItemLines(["1 白水泥 包 5 30 150", "跑腿费 13元", "镀锌管 6米 12.5 75", "合计 238元"]);
ok("散行明细：完整行", looseItems.some((it) => it.name === "白水泥" && it.unit === "包" && it.quantity === 5 && it.total === 150));
ok("散行明细：服务费金额", looseItems.some((it) => it.name === "跑腿费" && it.unit === "次" && it.quantity === 1 && it.total === 13));
ok("散行明细：数量单位粘连", looseItems.some((it) => it.name === "镀锌管" && it.unit === "米" && it.quantity === 6 && it.unitPrice === 12.5 && it.total === 75));

console.log("== vl-parse (PaddleOCR-VL HTML 表格) ==");
// VL 实际输出：表格是 HTML <table>（整段一行），抬头带 # / <div> / $^{®}$ 记号。
const mdDb =
  "# 广州市大板东建材有限公司\n\nNO.XS202605210034\n\n销售日期：2026-05-23\n\n" +
  "<table border=1><tr><td>编号</td><td>产品</td><td>单位</td><td>总数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>8*6美固钉</td><td>包</td><td>46</td><td>7.65</td><td>351.90</td></tr>" +
  "<tr><td>2</td><td>2厘夹板</td><td>张</td><td>50</td><td>23.2</td><td>1,160.00</td></tr>" +
  "<tr><td></td><td>合计</td><td>151</td><td></td><td></td><td>2,833.90</td></tr>" +
  '<tr><td colspan="6">合计金额：贰仟捌佰叁拾叁元玖角整2,833.90</td></tr></table>';
const rDb = parseVlToDocs([mdDb]);
ok("VL HTML 表格出明细2行", rDb.docs[0].items.length === 2);
ok("VL 公司去 # 记号", rDb.company === "广州市大板东建材有限公司");
ok("VL 保留尺寸 8*6", rDb.docs[0].items[0].name === "8*6美固钉");
ok("VL 单价/金额数字化", rDb.docs[0].items[0].unitPrice === 7.65 && rDb.docs[0].items[0].total === 351.9);
ok("VL 千分位金额", rDb.docs[0].items[1].total === 1160);
ok("VL 单号(NO.)", rDb.docs[0].orderNo === "XS202605210034");
ok("VL 合计行不入明细", !rDb.docs[0].items.some((it) => /合计/.test(it.name)));

// 公司名：避开"客户名称/送货地址"，取居中 <div> 抬头
const mdZd =
  '<div style="text-align: center;">佛山市智道建筑材料有限公司</div>\n\n客户名称：广州睿璟装饰工程有限公司\n\n单号：20260511001\n\n送货日期：2026年5月11日\n\n' +
  "<table border=1><tr><td>编号</td><td>产品名称</td><td>规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额/元</td></tr>" +
  "<tr><td>1</td><td>地面垫层砂浆M20</td><td>50KG/包</td><td>吨</td><td>35</td><td></td><td></td></tr></table>";
const rZd = parseVlToDocs([mdZd]);
ok("VL 公司避开客户名称", rZd.company === "佛山市智道建筑材料有限公司");
ok("VL 中文日期", rZd.docs[0].date === "2026-05-11");
ok("VL 明细(规格列不混入名)", rZd.docs[0].items[0].name === "地面垫层砂浆M20" && rZd.docs[0].items[0].quantity === 35);

// 一份文件多页 → 自动拆多单；公司剥离"送货单"后缀
const mkPage = (no) =>
  `# 富丰建材送货单\n\n地址：广州市天河区\n\nNo:${no}\n\n2026年4月26日\n\n` +
  "<table border=1><tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td></tr>" +
  "<tr><td>1</td><td>彩钢</td><td>平米</td><td>201.6</td></tr></table>";
const rFf = parseVlToDocs([mkPage("836585"), mkPage("836584")]);
ok("VL 多页拆多单", rFf.docs.length === 2);
ok("VL 公司剥离送货单后缀", rFf.company === "富丰建材");
ok("VL 公司不取地址行", !/地址/.test(rFf.company));
ok("VL 各单单号独立", rFf.docs[0].orderNo === "836585" && rFf.docs[1].orderNo === "836584");

// 扫描差：表头无"品名"列 → 默认首列为品名；印章/数量漏进首列的纯数字行丢弃
const mdPc =
  "# 销货清单\n\n收货单位：\n\n0034671\n\n" +
  "<table border=1><tr><td>地址：</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>5</td><td></td><td></td><td></td><td></td></tr>" +
  "<tr><td>液压钳</td><td></td><td></td><td></td><td></td></tr>" +
  "<tr><td>16铝铣耳</td><td>个</td><td>50</td><td></td><td></td></tr></table>";
const rPc = parseVlToDocs([mdPc]);
ok("VL 无品名表头默认首列", rPc.docs[0].items.some((it) => it.name === "液压钳"));
ok("VL 纯数字品名丢弃", !rPc.docs[0].items.some((it) => it.name === "5"));
ok("VL 首列名+单位+数量", rPc.docs[0].items.some((it) => it.name === "16铝铣耳" && it.unit === "个" && it.quantity === 50));
ok("pickSupplier 直接调用", pickSupplier(["# 销货清单", "客户名称：某某公司", "广州市大板东建材有限公司"]) === "广州市大板东建材有限公司");

console.log("== 单号抽取（issue #8）==");
// 富丰类预印单：红色流水号(0005876)常与税号/统一社会信用代码粘连成长串，取尾部流水号
ok("单号-税号粘连取尾部流水号", findOrderNo(["电话：020-85204317 191206840950005876"]) === "0005876");
ok("单号-税号粘连(4.28)", findOrderNo(["191206840950005874"]) === "0005874");
// 广东磊轶正规 NO 标签：原样保留，不受影响
ok("单号-正规NO标签不变", findOrderNo(["客户名称：广东瑞航 日期：2026-05-14 NO：XK-FS001-T-20260514-008"]) === "XK-FS001-T-20260514-008");
// 纯税号、抽不出前导零流水号 → 留空（宁空勿错，由 待复核 兜底）
ok("单号-纯税号无流水号则留空", findOrderNo(["统一社会信用代码 123456789012345678"]) === "");
ok("单号-短号标签正常保留", findOrderNo(["No:836585"]) === "836585");
// 集成：富丰一页两单（单号不同=两单），各取尾部红色流水号
const mdFuShuang =
  "# 富丰建材送货单\n\n电话：020-85204317 191206840950005876\n\n2026年5月4日\n\n" +
  "<table border=1><tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>方管</td><td>条</td><td>150</td><td>83</td><td>12450</td></tr></table>\n\n" +
  "# 富丰建材送货单\n\n电话：020-85204317 191206840950005877\n\n2026年5月4日\n\n" +
  "<table border=1><tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>321焊条</td><td>箱</td><td>1</td><td>122</td><td>122</td></tr></table>";
const rFuSh = parseVlToDocs([mdFuShuang]);
ok("VL 富丰双单拆2单", rFuSh.docs.length === 2);
ok("VL 富丰单1单号=0005876", rFuSh.docs[0].orderNo === "0005876");
ok("VL 富丰单2单号=0005877", rFuSh.docs[1].orderNo === "0005877");

console.log("== 明细解析增强（issue #9）==");
// 续行并入(M)：品名有字但 单位/数量/单价/金额 全空 → 并入上一条；"品名+仅金额"的服务费行保留
const md9cont =
  "# 富丰建材送货单\n\nNo:0005873\n\n2026年4月26日\n\n" +
  "<table border=1><tr><td>序号</td><td>品名及规格</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>彩钢 340大块蓝色</td><td>平米</td><td>201.6</td><td>13</td><td>2620</td></tr>" +
  "<tr><td>2</td><td>2.4米×84件</td><td></td><td></td><td></td><td></td></tr>" +
  "<tr><td>3</td><td>车费货拉拉中通</td><td></td><td></td><td></td><td>145</td></tr></table>";
const r9c = parseVlToDocs([md9cont]);
ok("续行并入上一条品名", r9c.docs[0].items.some((it) => it.name.includes("彩钢") && it.name.includes("2.4米×84件")));
ok("续行不单列成项", !r9c.docs[0].items.some((it) => it.name === "2.4米×84件"));
ok("服务费行(仅金额)保留", r9c.docs[0].items.some((it) => it.name.includes("车费") && it.total === 145));
// 行级算术：数量×单价≠金额（容差1元）→ item + doc 标待复核
const md9ar =
  "# 富丰建材送货单\n\nNo:0005876\n\n2026年5月4日\n\n" +
  "<table border=1><tr><td>序号</td><td>品名</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>322焊条</td><td>箱</td><td>1</td><td>122</td><td>1522</td></tr></table>";
const r9a = parseVlToDocs([md9ar]);
ok("行级算术不符标 item.note", /待复核/.test(r9a.docs[0].items[0].note || ""));
ok("行级算术不符标 doc.note", /待复核/.test(r9a.docs[0].note || ""));
// 合计对账：合计 ¥ 与明细求和不符 → doc 标待复核
const md9sum =
  "# 富丰\n\nNo:0005873\n\n2026年4月26日\n\n" +
  "<table border=1><tr><td>序号</td><td>品名</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>地推</td><td>套</td><td>4</td><td>17</td><td>68</td></tr>" +
  '<tr><td colspan="6">合计金额： 伍佰元（¥500）</td></tr></table>';
const r9s = parseVlToDocs([md9sum]);
ok("合计与明细不符标待复核", /合计/.test(r9s.docs[0].note || "") && /待复核/.test(r9s.docs[0].note || ""));
// 合计相符 → 不误报
const md9ok =
  "# 富丰\n\nNo:0005873\n\n2026年4月26日\n\n" +
  "<table border=1><tr><td>序号</td><td>品名</td><td>单位</td><td>数量</td><td>单价</td><td>金额</td></tr>" +
  "<tr><td>1</td><td>地推</td><td>套</td><td>4</td><td>17</td><td>68</td></tr>" +
  '<tr><td colspan="6">合计金额： 陆拾捌元（¥68）</td></tr></table>';
ok("合计相符不误报", !/合计/.test(parseVlToDocs([md9ok]).docs[0].note || ""));

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
// 字符级空格版式（每个字单独定位）：号码/税率 去空格后正确（issue #2）
const glyph = parseInvoice([
  "电子发票（普通发票） 发票号码： 2 6 3 3 2 0 0 0 0 0 2 9 7 7 3 4 4 3 1 6",
  "开票日期： 2 0 2 6 年0 4 月1 3 日",
  "购 名称： 广东瑞航建设工程有限公司 销 名称： 杭州丰畅科技有限公司",
  "项目名称 规格型号 单位 数量 单价 金额 税率/征收率 税额",
  "*洗涤剂*洗碗机专用粉 套 1 6 0 . 4 4 6 0 . 4 4 1 3 % 7 . 8 6",
  "合 计 ¥ 5 9 . 4 0 ¥ 7 . 7 2",
  "价税合计（大写） 陆拾柒圆壹角贰分 （小写） ¥ 6 7 . 1 2",
].join("\n"));
ok("空格版 发票号码", glyph.number === "26332000002977344316");
ok("空格版 税率 13%（非 3%）", glyph.rate === "13%");

console.log("== 分供方库（issue #6）==");
const { normalizeCompanyName, coreCompanyName, matchSupplier, collectFromInvoices, sellerTaxNoFromRawText, importSuppliersWorkbookBytes, exportSuppliersWorkbookBytes } = await import("../src/lib/supplier-db.js");
ok("归一化：去空格", normalizeCompanyName("兆鑫建 材") === "兆鑫建材");
ok("归一化：去尾部(1)", normalizeCompanyName("佛山市智道建筑材料有限公司(1)") === "佛山市智道建筑材料有限公司");
ok("核心名：去后缀", coreCompanyName("广州市大板东建材有限公司").includes("大板东"));
const supList = [
  { id: "a", name: "广州市大板东建材有限公司", aliases: [] },
  { id: "b", name: "佛山市智道建筑材料有限公司", aliases: ["智道"] },
];
ok("模糊匹配：简称→全称", matchSupplier(supList, "大板东")?.supplier.id === "a");
ok("别名匹配", matchSupplier(supList, "智道")?.supplier.id === "b");
ok("带(1)文件夹名匹配", matchSupplier(supList, "佛山市智道建筑材料有限公司(1)")?.supplier.id === "b");
ok("不存在的不乱配", matchSupplier(supList, "完全无关公司") === null);
const rawT = "购 信 统一社会信用代码/纳税人识别号： 91440101MA9XPYYU4M 信 统一社会信用代码/纳税人识别号： 91440703MABLK2EL12";
ok("销售方税号取第2个", sellerTaxNoFromRawText(rawT) === "91440703MABLK2EL12");
const colList = [];
collectFromInvoices(colList, [{ status: "done", fields: { seller: "江门市海豚电器有限公司" }, rawText: rawT }]);
ok("发票收集新增", colList.length === 1 && colList[0].taxNo === "91440703MABLK2EL12");
const supXlsx = exportSuppliersWorkbookBytes(colList);
const reList = [];
const imp = importSuppliersWorkbookBytes(reList, supXlsx);
ok("Excel 导出→导入回读", imp.added === 1 && reList[0].name === "江门市海豚电器有限公司" && reList[0].taxNo === "91440703MABLK2EL12");

console.log("== VL 云识别解析（vl-parse）==");
const vp = await import("../src/lib/vl-parse.js");
const ov = await import("../src/lib/ocr-vl.js");
ok("VL job 响应解 data", ov.unwrapVlEnvelope({ code: 0, msg: "Success", data: { jobId: "job-1" } }).jobId === "job-1");
ok("VL 状态响应解 extractProgress", ov.unwrapVlEnvelope({ data: { state: "running", extractProgress: { totalPages: 2, extractedPages: 1 } } }).extractProgress.totalPages === 2);
const vlResultJson = ov.parseVlResultText(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "单页结果" } }] } }));
ok("VL 结果 JSON 解 result", vlResultJson.layoutParsingResults[0].markdown.text === "单页结果");
const vlResultJsonl = ov.parseVlResultText(
  [
    JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "第一页" } }] } }),
    JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: "第二页" } }] } }),
  ].join("\n")
);
ok("VL 结果 JSONL 合并", vlResultJsonl.layoutParsingResults.length === 2 && vlResultJsonl.layoutParsingResults[1].markdown.text === "第二页");
const vlMd = [
  [
    "广州市大板东建材有限公司销货清单",
    "单号：XS202605230011  2026年5月23日",
    "| 序号 | 品名及规格 | 单位 | 数量 | 单价 | 金额 |",
    "| --- | --- | --- | --- | --- | --- |",
    "| 1 | 9厘夹板 | 张 | 10 | 52 | 520 |",
    "| 2 | 车费 | 次 | 1 | 120 | 120 |",
    "| 合计 |  |  |  |  | 640 |",
    "",
    "广州富丰建材贸易有限公司送货单",
    "№ 0005880  2026年5月11日",
    "| 品名 | 单位 | 数量 | 单价 | 金额 |",
    "| --- | --- | --- | --- | --- |",
    "| 30镀锌消防门铰 | 件 | 1 | 135 | 135 |",
  ].join("\n"),
];
const vlRes = vp.parseVlToDocs(vlMd);
ok("一页两表→拆成2张单", vlRes.docs.length === 2);
ok("单1 公司", vlRes.docs[0].company.includes("大板东"));
ok("单1 日期", vlRes.docs[0].date === "2026-05-23");
ok("单1 明细2行(合计行剔除)", vlRes.docs[0].items.length === 2 && vlRes.docs[0].items[0].name === "9厘夹板");
ok("单1 数量/单价/总价数字化", vlRes.docs[0].items[0].quantity === 10 && vlRes.docs[0].items[0].unitPrice === 52 && vlRes.docs[0].items[0].total === 520);
ok("单2 公司", vlRes.docs[1].company.includes("富丰"));
ok("单2 单号", vlRes.docs[1].orderNo === "0005880");
ok("无表格→兜底单张", vp.parseVlToDocs(["只有 一行文字 广州市大板东建材有限公司 2026年5月1日"]).docs.length === 1);
ok("无表头表格→按列序猜", vp.tableToItems([["1", "白水泥", "包", "5", "30", "150"]]).length === 1);
const vlLoose = vp.parseVlToDocs([["广州市大板东建材有限公司送货单", "2026年5月1日", "白水泥 包 5 30 150", "跑腿费 13元"].join("\n")]);
ok("VL 无表格→散行材料", vlLoose.docs[0].items.length === 2 && vlLoose.docs[0].itemsSource === "line");

console.log("== 整理树（issue #5）==");
const dt = await import("../src/lib/delivery-tree.js");
ok("文件名日期 2026.5.23", dt.dateFromFilename("2026.5.23大板东.pdf") === "2026-05-23");
ok("文件名日期 横杠", dt.dateFromFilename("2026-04-29佛山智道.png") === "2026-04-29");
ok("无年份不猜", dt.dateFromFilename("5.10大沥浩臻.pdf") === "");
ok("工地名建议", dt.suggestSiteName("合和新城送货单共享文件夹") === "合和新城");
ok("特殊夹：序号前缀", dt.isSpecialFolderName("4-未签合同-送货单") === true);
ok("特殊夹：纯数字", dt.isSpecialFolderName("1") === true);
ok("供应商夹不是特殊", dt.isSpecialFolderName("大板东") === false);

const treeSuppliers = [
  { id: "s1", name: "广州市大板东建材有限公司", aliases: ["大板东"] },
  { id: "s2", name: "佛山市智道建筑材料有限公司", aliases: ["智道"] },
  { id: "s3", name: "广东鹏程电气设备有限公司", aliases: ["广东鹏程"] },
];
const mkEntry = (relPath) => ({ file: { name: relPath.split("/").pop() }, relPath });
const tree = dt.buildTree(
  [
    mkEntry("合和新城送货单共享文件夹/大板东/2026.5.23大板东.pdf"),
    mkEntry("合和新城送货单共享文件夹/佛山市智道建筑材料有限公司/2026.5.10智道.pdf"),
    mkEntry("合和新城送货单共享文件夹/佛山市智道建筑材料有限公司(1)/2026.5.12智道.pdf"),
    mkEntry("合和新城送货单共享文件夹/4-未签合同-送货单/2026.5.23广东鹏程.pdf"),
    mkEntry("合和新城送货单共享文件夹/合和新城7期室内装修材料台帐.xlsx"),
    mkEntry("合和新城送货单共享文件夹/散单.pdf"),
  ],
  treeSuppliers
);
ok("单根=一个工地", tree.sites.length === 1);
ok("工地名已清洗", tree.sites[0].name === "合和新城");
ok("台帐被忽略", tree.ignored === 1);
const groups = tree.sites[0].groups;
ok("同名(1)文件夹自动合并", groups.filter((g) => g.rawName.includes("智道")).length === 1);
const zd = groups.find((g) => g.rawName.includes("智道"));
ok("简称映射到全称", zd.company === "佛山市智道建筑材料有限公司");
const sp = groups.find((g) => g.rawName === "4-未签合同-送货单");
ok("特殊组识别", sp && sp.kind === "special" && sp.company === "未签合同-送货单");
ok("特殊组文件名疑似建议", sp.files[0].suggestLabel.includes("鹏程") === false || sp.files[0].suggestGroupKey === "");
ok("散文件进待分组", groups.some((g) => g.rawName === dt.PENDING_GROUP && g.files.some((f) => f.name === "散单.pdf")));

// 根文件夹名=供应商简称 → 挂（未命名工地）
const tree2 = dt.buildTree([mkEntry("大板东/2026.5.5.pdf")], treeSuppliers);
ok("供应商根→未命名工地", tree2.sites[0].name === dt.UNNAMED_SITE && tree2.sites[0].groups[0].company === "广州市大板东建材有限公司");

// 升级/降级/移动/拍平
const pg = dt.promoteGroupToSite(tree, zd.key);
ok("组升级为工地", tree.sites.length === 2 && pg.groups.length === 1);
ok("降级并回", dt.demoteSiteToGroup(tree, pg.key, tree.sites[0].key) === true && tree.sites.length === 1);
const spFile = sp.files[0];
ok("移动文件", dt.moveFile(tree, spFile.key, zd.key) === true && zd.files.some((f) => f.key === spFile.key));
const flat = dt.flattenForApply(tree);
ok("拍平条数", flat.length === 5);
const flatZd = flat.filter((e) => e.company === "佛山市智道建筑材料有限公司");
ok("拍平公司预填", flatZd.length === 3);
ok("拍平日期预填", flat.some((e) => e.dateGuess === "2026-05-23"));
ok("特殊组标记", flat.every((e) => (e.groupName === dt.PENDING_GROUP ? e.special : true)));

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
// 脱敏星号（何* / 45222919****817）不得被当成 *税收分类*；货运大类归到“运输服务/交通运输”
const freightMasked = parseInvoice([
  "货物运输电子收款凭证",
  "承运人姓名: 何* 承运人身份证号码: 45222919****817",
  "费用合计(大写) (小写): ¥ 53.37  申请日期: 2026-03-24",
].join("\n"));
ok("货运凭证大类不抓脱敏文字", /^[一-龥]+$/.test(freightMasked.category) && !/号码|身份证/.test(freightMasked.category));
ok("货运凭证大类=运输类", bigCategory(freightMasked) === "交通运输" || bigCategory(freightMasked) === "运输服务");
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

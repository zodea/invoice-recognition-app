// 财务费用报销导出：按「公司」拆分，生成 交接单 / 专票 / 普票 / 其他 / 医疗门诊 多页 Excel，
// 参照《瑞航公司费用报销》格式。核心是把每张发票的“劳务、服务名称(*税收分类*)”归到一个
// 大类统称词上，交接单按 发票类型 × 大类 汇总（金额=价税合计、张数=张数）。
import * as XLSX from "xlsx";

// 大类归纳规则：命中即归到该统称词（顺序优先）。匹配范围含 税收分类/服务名/票面备注。
const CATEGORY_RULES = [
  [/汽油|柴油|成品油|燃油|加油/, "汽油"],
  [/餐饮|餐厅|饭店|食堂|烧烤|火锅/, "餐饮服务"],
  [/客运|出租|网约|行程|打车|滴滴|曹操|优行|如约|运输|货拉拉|货运|高速|路桥|停车|车费/, "交通运输"],
  [/住宿|酒店|宾馆|旅业/, "住宿服务"],
  [/物业|管理服务|现代服务|供电|电费|水费|租赁|房租|租金/, "企业管理服务"],
  [/服装|鞋|纺织|西服|衣/, "服装"],
  [/维修|修理|保养/, "维修费"],
  [/快递|收派|寄递|邮政|物流/, "快递服务"],
  [/培训|教育|会议|咨询/, "培训费"],
  [/医疗|门诊|医院|药|诊疗|挂号/, "医疗"],
  [/办公|文具|复印|打印|图文|纸/, "办公用品"],
  [/日用|百货|超市|便利|清洁|家居|家用|厨|电器|数码|电子|工艺品|花卉|园艺/, "日用品"],
];

export function bigCategory(inv) {
  const f = (inv && inv.fields) || inv || {};
  const hay = `${f.category || ""} ${f.service || ""} ${f.remark || ""} ${f.seller || ""}`;
  for (const [re, name] of CATEGORY_RULES) if (re.test(hay)) return name;
  return (f.category || f.service || "其他").trim() || "其他";
}

// 报销分类：专用发票 / 普通发票 / 医疗门诊 / 其他
export function classifyReimburseKind(inv) {
  const f = (inv && inv.fields) || inv || {};
  const t = `${f.taxKind || ""}${f.type || ""}`;
  const doc = f.docType || "";
  if (/医疗|门诊|医院|挂号|诊疗/.test(`${f.category || ""}${f.service || ""}${f.seller || ""}`)) return "医疗门诊";
  if (doc === "行程单" || doc === "货物运输凭证" || doc === "未识别") return "其他";
  if (/专用/.test(t)) return "专用发票";
  if (/普通/.test(t)) return "普通发票";
  if (doc === "增值税发票") return "普通发票"; // 增票但未分专普 → 归普票
  return "其他";
}

const KIND_ORDER = ["专用发票", "普通发票", "医疗门诊", "其他"];
const KIND_LABEL = { 专用发票: "电子专用发票", 普通发票: "电子普通发票", 医疗门诊: "医疗票据", 其他: "其他" };

function shortCompany(name) {
  const n = String(name || "").replace(/\s/g, "");
  for (const k of ["瑞航", "百信", "力沣"]) if (n.includes(k)) return k;
  return (
    n.replace(/^(广州市|广东省|广东|广州)/, "").replace(/(股份有限公司|有限责任公司|有限公司)$/, "").slice(0, 6) || "公司"
  );
}
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? "" : Number(v));
function todayCn() {
  const d = new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
function dateStr(f) {
  return f.date || f.dateText || "";
}

// 按大类分组，返回 [{ cat, items:[inv...], total }]，组顺序按出现先后
function groupByCategory(invs) {
  const map = new Map();
  for (const inv of invs) {
    const c = bigCategory(inv);
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(inv);
  }
  return [...map.entries()].map(([cat, items]) => ({
    cat,
    items,
    total: round2(items.reduce((s, i) => s + (Number((i.fields || {}).total) || 0), 0)),
  }));
}

function addSheet(wb, name, rows, cols, used) {
  let nm = name.slice(0, 31);
  let i = 2;
  while (used.has(nm)) { nm = `${name.slice(0, 28)}(${i++})`; }
  used.add(nm);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if (cols) ws["!cols"] = cols;
  XLSX.utils.book_append_sheet(wb, ws, nm);
}

export function buildReimburseWorkbookBytes(invoices) {
  const wb = XLSX.utils.book_new();
  const used = new Set();

  // 按公司(购买方)分组
  const byCompany = new Map();
  for (const inv of invoices) {
    const company = ((inv.fields || {}).buyer || "").trim() || "未识别购买方";
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(inv);
  }

  for (const [company, invs] of byCompany.entries()) {
    const sc = shortCompany(company);
    const byKind = { 专用发票: [], 普通发票: [], 医疗门诊: [], 其他: [] };
    for (const inv of invs) byKind[classifyReimburseKind(inv)].push(inv);

    // —— 交接单：按 类型 × 大类 汇总 ——
    const handover = [[`${company}费用报销登记表`], ["序号", "费用报销内容", "发票金额", "张数", "接收人", "发票类型", "签收人"]];
    let seq = 0, grand = 0;
    for (const kind of KIND_ORDER) {
      const groups = groupByCategory(byKind[kind]);
      for (const g of groups) {
        seq++;
        grand += g.total;
        handover.push([seq, g.cat, g.total, g.items.length, "", KIND_LABEL[kind], ""]);
      }
    }
    handover.push(["合计", "", round2(grand)]);
    handover.push([`制表人：                                   日期：${todayCn()}`]);
    handover.push(["签收人：                                   日期："]);
    addSheet(wb, `交接单-${sc}`, handover, [{ wch: 5 }, { wch: 28 }, { wch: 13 }, { wch: 6 }, { wch: 10 }, { wch: 14 }, { wch: 10 }], used);

    // —— 专票 ——
    if (byKind.专用发票.length) {
      const rows = [[`${company}专用发票费用报销`], ["开票日期", "发票号码", "开票单位", "劳务、服务名称", "金额", "税率", "税额", "价税合计", "价税分类小计", "备注"]];
      for (const g of groupByCategory(byKind.专用发票)) {
        g.items.forEach((inv, idx) => {
          const f = inv.fields || {};
          rows.push([dateStr(f), f.number || "", f.seller || "", f.service || f.category || "", num(f.amount), f.rate || "", num(f.tax), num(f.total), idx === 0 ? g.total : "", f.remark || ""]);
        });
      }
      addSheet(wb, `专票-${sc}`, rows, [{ wch: 11 }, { wch: 22 }, { wch: 26 }, { wch: 24 }, { wch: 11 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 13 }, { wch: 18 }], used);
    }

    // —— 普票 ——
    if (byKind.普通发票.length) {
      const rows = [[`${company}费用报销发票`], ["序号", "开票日期", "发票号码", "开票单位", "劳务、服务名称", "价税合计", "价税分类小计", "备注"]];
      let n = 0;
      for (const g of groupByCategory(byKind.普通发票)) {
        g.items.forEach((inv, idx) => {
          const f = inv.fields || {};
          rows.push([++n, dateStr(f), f.number || "", f.seller || "", f.service || f.category || "", num(f.total), idx === 0 ? g.total : "", f.remark || ""]);
        });
      }
      addSheet(wb, `普票-${sc}`, rows, [{ wch: 5 }, { wch: 11 }, { wch: 22 }, { wch: 26 }, { wch: 24 }, { wch: 11 }, { wch: 13 }, { wch: 18 }], used);
    }

    // —— 医疗门诊 ——
    if (byKind.医疗门诊.length) {
      const rows = [["医疗门诊票据费用登记表"], ["序号", "开票日期", "付款名称", "收款名称", "金额（元）", "发票号码", "价税合计"]];
      let n = 0, mt = 0;
      byKind.医疗门诊.forEach((inv) => {
        const f = inv.fields || {};
        mt += Number(f.total) || 0;
        rows.push([++n, dateStr(f), f.buyer || "", f.seller || "", num(f.total), f.number || "", n === 1 ? round2(byKind.医疗门诊.reduce((s, i) => s + (Number((i.fields || {}).total) || 0), 0)) : ""]);
      });
      addSheet(wb, `医疗门诊-${sc}`, rows, [{ wch: 5 }, { wch: 11 }, { wch: 14 }, { wch: 26 }, { wch: 12 }, { wch: 18 }, { wch: 12 }], used);
    }

    // —— 其他（行程单/货运凭证/未识别）——
    if (byKind.其他.length) {
      const rows = [[`${company}其他报销凭证`], ["序号", "开票日期", "发票号码", "开票单位", "劳务、服务名称", "价税合计", "价税分类小计", "类型", "备注"]];
      let n = 0;
      for (const g of groupByCategory(byKind.其他)) {
        g.items.forEach((inv, idx) => {
          const f = inv.fields || {};
          rows.push([++n, dateStr(f), f.number || "", f.seller || "", f.service || f.category || "", num(f.total), idx === 0 ? g.total : "", f.docType || f.type || "", f.remark || ""]);
        });
      }
      addSheet(wb, `其他-${sc}`, rows, [{ wch: 5 }, { wch: 11 }, { wch: 22 }, { wch: 26 }, { wch: 24 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 16 }], used);
    }
  }

  if (!used.size) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["无可导出的发票"]]), "空");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}

export function reimburseWorkbookName(invoices) {
  const dates = invoices.map((i) => (i.fields || {}).date || (i.fields || {}).dateText || "").filter(Boolean).sort();
  const d = new Date();
  const stamp = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return dates.length ? `${stamp}费用报销_${dates[0]}至${dates[dates.length - 1]}.xlsx` : `${stamp}费用报销.xlsx`;
}

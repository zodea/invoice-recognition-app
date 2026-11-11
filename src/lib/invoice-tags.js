export const EXPENSE_TAGS = ["交通", "餐饮", "通讯", "住宿", "医疗", "物流", "租赁", "物管", "商品", "服务", "其他"];
const rules = [
  ["医疗", /医疗|门诊|诊疗|挂号|药品/],
  ["物流", /物流|货运|货物运输|快递|寄递|收派/],
  ["交通", /汽油|柴油|燃油|加油|客运|出租车|网约车|行程单|打车|路桥|过路费|停车|停泊|停放/],
  ["餐饮", /餐饮|餐费|餐厅|饭店|食堂/],
  ["通讯", /通信|通讯|话费|流量费|电话费/],
  ["住宿", /住宿|酒店|宾馆|旅馆/],
  ["租赁", /租赁|房租|租金/],
  ["物管", /物业|物管/],
  ["商品", /商品|办公用品|文具|日用品|纸张/],
  ["服务", /服务费|咨询服务|维修服务|技术服务/],
];
export function inferExpenseTag(inv) {
  const f = inv?.fields || inv || {};
  const text = `${f.category || ""} ${f.service || ""} ${f.docType || ""}`;
  let hits = rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  // “车辆停泊服务费”同时含通用“服务费”，应保留更具体的停车分类。
  if (/车辆停(?:泊|放)服务费/.test(text)) hits = hits.filter(tag => tag !== "服务");
  return hits.length === 1 ? hits[0] : "";
}

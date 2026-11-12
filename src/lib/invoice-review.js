import { standaloneDocumentType } from "./document-kind.js";
export function invoiceProblems(f = {}) {
  const errors = [];
  const standaloneType = standaloneDocumentType(f);
  for (const [key,label] of [["number","发票号码"],["date","开票日期"],["buyer","购买方"],["seller","销售方"],["type","票种"]]) {
    if (standaloneType && key === "buyer") continue;
    if (['行程单', '付款凭证'].includes(standaloneType) && key === "number") continue;
    if (!String(f[key] || (key === "type" ? f.taxKind || f.docType : "") || "").trim()) errors.push('缺少'+label);
  }
  if (standaloneType !== "行程单" && f.number && !/^\d{8,25}$/.test(f.number)) errors.push("发票号码格式不正确");
  if (f.date && (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || !Number.isFinite(Date.parse(f.date)) || new Date(f.date).toISOString().slice(0,10) !== f.date)) errors.push("开票日期无效");
  if (f.total === "" || f.total == null || !Number.isFinite(Number(f.total))) errors.push("缺少有效价税合计");
  if (f.buyer && f.seller && (f.buyer === f.seller || f.seller.includes(f.buyer))) errors.push("买卖方疑似混合，请对照原件");
  for (const k of ["amount","tax"]) if (f[k] !== "" && f[k] != null && !Number.isFinite(Number(f[k]))) errors.push("金额或税额无效");
  if ([f.amount,f.tax,f.total].every(v => v !== "" && v != null && Number.isFinite(Number(v))) && Math.abs(Number(f.amount)+Number(f.tax)-Number(f.total)) > .02) errors.push("金额加税额与价税合计不一致");
  return errors;
}

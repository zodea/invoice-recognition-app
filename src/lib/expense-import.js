import { isMultiProject, projectNames } from './invoice-allocation.js';
import { paymentDate } from "./payment-records.js";
import * as XLSX from "xlsx";
import { inferExpenseTag } from "./invoice-tags.js";
import {isAssignmentWorkbook} from './expense-assignment-import.js';

// 报销表的“金额”是价税合计；只接受完整的数电号码，避免短号码误匹配。
export function importExpenseWorkbook(ledger, bytes, options = {}) {
  const wb = XLSX.read(bytes, { type: "array", cellDates: true });
  if(isAssignmentWorkbook(wb))throw new Error('这是归属导入表，请使用“批量导入归属”，不能当作报销记录导入');
  const candidates = new Map();
  let skipped = 0, conflicts = 0, added = 0, updated = 0;
  const review = [];
  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "", raw: true });
    const index = rows.findIndex(row => row.map(v => String(v).trim()).includes("发票号码"));
    if (index < 0) continue;
    const headers = rows[index].map(v => String(v).trim());
    const get = (row, ...names) => { const i = (names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1); return i < 0 ? "" : row[i]; };
    for (const row of rows.slice(index + 1)) {
      const raw = get(row, "发票号码");
      const number = typeof raw === "string" ? raw.replace(/\s/g, "") : "";
      if (!/^\d{18,25}$/.test(number)) { if (raw) { skipped++; review.push({number:String(raw), source:options.sourceName + " / " + sheet, status:"待核对", reason:"号码不完整或 Excel 数值精度不可靠"}); } continue; }
      const text = value => String(value ?? "").trim();
      const amountRaw = get(row, "价税合计", "金额");
      const amount = amountRaw === "" ? "" : Number(amountRaw);
      const dateRaw = get(row, "发票日期", "开票日期");
      const date = paymentDate(dateRaw);
      const item = { key: number, number, date, seller: text(get(row, "公司名称", "销售方", "开票单位", "收款方")), total: Number.isFinite(amount) ? amount : "", project: text(get(row, "使用工地", "工地")), payer: text(get(row, "付款账户", "付款人")), type: text(get(row, "发票类型")) };
      item.paymentDate = paymentDate(get(row,"支付日期"));
      item.remark = text(get(row,"备注"));
      item.period = options.period || "";
      item.source = `${options.sourceName || "报销表"} / ${sheet}`;
      item.service = text(get(row, "费用名称", "项目名称"));
      item.expenseTag = inferExpenseTag(item);
      const prev = candidates.get(number);
      if (prev && ["project", "payer", "total", "date"].some(k => prev[k] !== "" && item[k] !== "" && prev[k] !== item[k])) { candidates.set(number, null); continue; }
      if (candidates.has(number) && !prev) continue;
      candidates.set(number, prev ? Object.fromEntries(Object.keys(item).map(k => [k, prev[k] || item[k]])) : item);
    }
  }
  const next = { ...(ledger || {}) };
  for (const [number, item] of candidates) {
    if (!item) { conflicts++; review.push({number, status:"冲突", reason:"表内同号码信息不一致"}); continue; }
    const prev = next[number];
    if (prev?.reimbursement === "已报销" && prev.reimbursementPeriod && options.period && prev.reimbursementPeriod !== options.period) { conflicts++; review.push({...item,status:"冲突",reason:"已在其他报销期间登记"}); continue; }
    if (prev && (!prev.date || prev.total === "" || prev.total == null)) { conflicts++; review.push({...item,status:"待核对",reason:"台账日期或金额不完整，请先补全复核"}); continue; }
    if (prev && (item.total === "" || !Number.isFinite(Number(item.total)) || !item.date)) { conflicts++; review.push({...item,status:"待核对",reason:"缺少有效日期或金额，不能确认报销"}); continue; }
    if (prev && isMultiProject(prev) && item.project && item.project !== projectNames(prev)) { conflicts++; review.push({...item, status:'冲突', reason:'台账已有多工地分配，请核对原分配，不以单工地覆盖'}); continue; }
    if (prev && ((prev.total !== "" && prev.total != null && item.total !== "" && Math.abs(Number(prev.total) - item.total) > 0.01) || (prev.date && item.date && prev.date !== item.date) || ["project", "payer"].some(k => !(k === "project" && isMultiProject(prev)) && prev[k] && item[k] && prev[k] !== item[k]))) { conflicts++; review.push({...item, status:"冲突", reason:"金额、日期、工地或付款人不一致"}); continue; }
    if (prev) {
      const merged = { ...prev };
      if (options.period) { merged.reimbursement = "已报销"; merged.reimbursementPeriod = options.period; merged.reimbursementSource = item.source; }
      review.push({...item, status:"匹配", reason:"号码及已有金额、日期已核对"});
      for (const k of ["project", "payer", "service", "paymentDate", "remark"]) if (!(k === "project" && isMultiProject(prev)) && !merged[k] && item[k]) merged[k] = item[k];
      if (!merged.expenseTagSet && !merged.expenseTag && item.expenseTag) merged.expenseTag = item.expenseTag;
      if (options.period || merged.project !== prev.project || merged.payer !== prev.payer || merged.expenseTag !== prev.expenseTag || merged.service !== prev.service || merged.paymentDate !== prev.paymentDate || merged.remark !== prev.remark) { next[number] = merged; updated++; }
    } else { review.push({...item, status:"未找到", reason:"台账没有此号码，不新增发票"}); }
  }
  return { ledger: next, added, updated, skipped, conflicts, recognized: candidates.size, review, unmatched: review.filter(r => r.status === "未找到").length };
}

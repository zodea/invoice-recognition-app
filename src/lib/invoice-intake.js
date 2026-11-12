import { createBuyerChecker, normalizeBuyerName, buyerCheckLabels } from './invoice-buyer-check.js';
import { standaloneDocumentType } from './document-kind.js';
import { invoiceProblems } from './invoice-review.js';
import { historyStatus, ledgerKey } from './invoice-ledger.js';
import {supplementType} from './invoice-supplements.js';

export function receiptType(fields = {}) {
  return standaloneDocumentType(fields) || ([fields.docType, fields.type].find(value => ['货物运输凭证', '收款凭证', '其他票据'].includes(value)) || '');
}
export function intakeFingerprint(inv) {
  return JSON.stringify([inv.fields, inv.expenseTag || '', !!inv.expenseTagSet]);
}
export function intakeDecision(inv, buyers, ledger = {}) {
  if (inv.linkedLedgerKey) return { state: 'linked', label: '已关联主发票', reason: '作为附件保留，不重复计入费用。' };
  if (inv.supplementHash) return {state:'attachment-saved',label:'附件已保存，待匹配',reason:'原件已独立保存；主票到齐后自动匹配，附件不计入费用。'};
  if (inv.paymentId) return { state: 'payment-saved', label: '已转付款凭证', reason: '请到付款凭证核对原件和费用归属。' };
  if (inv.status !== 'done') return { state: 'unrecognized', label: '待识别', reason: '请先完成识别。' };
  if (inv.fields?.direction === 'income') return { state: 'review', label: '收款记录待核对', reason: '原件为收款或退款入账，不能作为付款支出，请核对对应业务。' };
  if (supplementType(inv.fields)) return {state:'supplement',label:'发票附件',reason:'保存原件并自动匹配主发票，附件不另计费；没有主票时先保留等待。'};
  if (inv.otherReceiptConfirmed || receiptType(inv.fields)) return { state: 'receipt', label: '其他票据', reason: '保存到付款凭证，不进入历史进项台账。' };
  const match = createBuyerChecker(buyers)(inv.fields);
  if (match !== 'matched') return { state: 'review', label: '需要核对', reason: buyerCheckLabels[match]+'，请核对购买方或标记为其他票据。' };
  const problems = invoiceProblems(inv.fields);
  if (problems.length) return { state: 'review', label: '需要核对', reason: problems.join('；') };
  const previous = ledger[ledgerKey(inv)];
  if (previous && (historyStatus(ledger, inv).needsReview || ['buyer','seller'].some(key => previous[key] && normalizeBuyerName(previous[key]) !== normalizeBuyerName(inv.fields[key])))) {
    return { state: 'review', label: '同号信息冲突', reason: '同号码历史发票的日期、金额、代码或买卖方不一致，请在历史台账对照原件，不能直接覆盖。' };
  }
  if (!inv.manualEditPending && inv.savedFingerprint === intakeFingerprint(inv) && previous) return { state: 'saved', label: '已保存到台账', reason: '原件已关联。' };
  return { state: 'ready', label: '可直接入账', reason: '购买方已在档案中，号码、日期和金额检查通过，可保存到历史进项台账。' };
}
export function canEnterLedger(inv, buyers, ledger = {}) {
  return ['ready', 'saved'].includes(intakeDecision(inv, buyers, ledger).state);
}
export function planRecognizedInvoice(ledger, inv, buyers) {
  const decision = intakeDecision(inv, buyers, ledger);
  if (!['ready','saved'].includes(decision.state)) throw new Error(decision.reason);
  const fields = inv.fields, key = ledgerKey(inv), previous = ledger[key];
  const base = { ...fields, key, number: String(fields.number).replace(/\s/g, ''), service: fields.service || fields.category || '', firstSeen: new Date().toISOString().slice(0,10), verified: false, printed: false, batches: [], reimbursement: '未核对' };
  // 保存识别结果不表示已经打印、抵税或报销；已有人工/官方字段优先。
  const entry = previous ? { ...base, ...Object.fromEntries(Object.entries(previous).filter(([,value]) => value !== '' && value != null)) } : base;
  if (inv.expenseTagSet || !entry.expenseTagSet) { entry.expenseTag = inv.expenseTag || entry.expenseTag || ''; entry.expenseTagSet = !!inv.expenseTagSet; }
  return { ledger: { ...ledger, [key]: entry }, key };
}

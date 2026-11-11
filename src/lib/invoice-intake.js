import { createBuyerChecker, normalizeBuyerName, buyerCheckLabels } from './invoice-buyer-check.js';
import { standaloneDocumentType } from './document-kind.js';
import { invoiceProblems } from './invoice-review.js';
import { historyStatus, ledgerKey } from './invoice-ledger.js';

export function receiptType(fields = {}) {
  return standaloneDocumentType(fields) || ([fields.docType, fields.type].find(value => ['货物运输凭证', '收款凭证', '其他票据'].includes(value)) || '');
}
export function intakeFingerprint(inv) {
  return JSON.stringify([inv.fields, inv.expenseTag || '', !!inv.expenseTagSet]);
}
export function intakeDecision(inv, buyers, ledger = {}) {
  if (inv.linkedLedgerKey) return { state: 'linked', label: '已关联主发票', reason: '作为附件保留，不重复计入费用。' };
  if (inv.paymentId) return { state: 'payment-saved', label: '已转付款凭证', reason: '请到付款凭证核对原件和费用归属。' };
  if (inv.status !== 'done') return { state: 'unrecognized', label: '待识别', reason: '请先完成识别。' };
  if (inv.otherReceiptConfirmed || receiptType(inv.fields)) return { state: 'receipt', label: '其他票据', reason: '保存到付款凭证，不进入历史进项台账。' };
  const match = createBuyerChecker(buyers)(inv.fields);
  if (match !== 'matched') return { state: 'review', label: '需要核对', reason: buyerCheckLabels[match]+'，请核对购买方或标记为其他票据。' };
  const problems = invoiceProblems(inv.fields);
  if (problems.length) return { state: 'review', label: '需要核对', reason: problems.join('；') };
  const previous = ledger[ledgerKey(inv)];
  if (previous && (historyStatus(ledger, inv).needsReview || ['buyer','seller'].some(key => previous[key] && normalizeBuyerName(previous[key]) !== normalizeBuyerName(inv.fields[key])))) {
    return { state: 'review', label: '同号信息冲突', reason: '同号码历史发票的日期、金额、代码或买卖方不一致，请在历史台账对照原件，不能直接覆盖。' };
  }
  if (inv.savedFingerprint === intakeFingerprint(inv) && previous) return { state: 'saved', label: '已保存到台账', reason: '原件已关联。' };
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

export function tripInvoiceCandidates(fields, ledger, query = '') {
  const q = query.trim().toLowerCase();
  return Object.values(ledger).filter(entry => !receiptType(entry) && (!q || `${entry.number} ${entry.seller} ${entry.buyer} ${entry.date}`.toLowerCase().includes(q))).map(entry => {
    const sameTotal = [entry.total, fields.total].every(value => value !== '' && value != null && Number.isFinite(Number(value))) && Math.abs(Number(entry.total)-Number(fields.total)) < .01;
    const sameDate = !!fields.date && entry.date === fields.date;
    return { entry, score: (sameTotal ? 2 : 0) + (sameDate ? 1 : 0), hint: sameTotal && sameDate ? '日期、金额一致' : sameTotal ? '金额一致' : sameDate ? '日期一致' : '手动核对' };
  }).sort((a,b) => b.score-a.score || String(b.entry.date || '').localeCompare(String(a.entry.date || '')));
}

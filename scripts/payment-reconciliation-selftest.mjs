import assert from 'node:assert/strict';
import { paymentEvidenceCandidates, reviewPaymentImport } from '../src/lib/payment-reconciliation.js';
const record = { id: 'batch.xlsx|sheet|3', date: '2026-06-01', seller: '测试商户', total: 74, payer: '赵东', project: '工地', purpose: '材料' };
const files = [{ name: 'a.png', fields: {date:'2026-06-01', seller:'测试商户', total:74} }, { name: 'b.pdf', fields: {date:'2026-06-01', seller:'另一商户', total:74} }, { name: 'c.png', fields: {date:'2026-06-02', seller:'测试商户', total:74} }];
assert.equal(paymentEvidenceCandidates(record, [{name:'2026-06-01-测试商户-74.00元.png'}]).length, 0);
const candidates = paymentEvidenceCandidates(record, files);
assert.equal(candidates.length, 2); assert.equal(candidates[0].sameSeller, true); assert.equal(candidates[1].sameSeller, false);
const reviewed = reviewPaymentImport([record], [], files, '批次一');
assert.equal(reviewed[0].canImport, true); assert.equal(reviewed[0].candidates.length, 2); assert.equal(reviewed[0].record.evidenceConfirmed, false);
assert.equal(reviewed[0].record.reimbursementPeriod, '批次一'); assert.equal(record.reimbursementPeriod, undefined);
const existing = [{ ...record, reimbursement: '已报销', evidenceHash: 'retained', evidenceConfirmed: true }];
assert.equal(reviewPaymentImport([record], existing)[0].status, '来源已存在');
assert.equal(reviewPaymentImport([{ ...record, total: 75 }], existing)[0].status, '来源内容冲突');
assert.equal(existing[0].reimbursement, '已报销'); assert.equal(existing[0].evidenceHash, 'retained');
assert.equal(reviewPaymentImport([{ ...record, id: 'other-source' }], existing)[0].status, '疑似重复');
assert.equal(reviewPaymentImport([{ ...record, date: '' }], [])[0].canImport, false);
assert.equal(reviewPaymentImport([record, record], [])[1].canImport, false, '同次导入也防止重复来源行');
let textReads = 0;
const screenshot = {
  name: 'receipt.png',
  fields: { date: record.date, total: record.total },
  pages: [{ get text() { textReads++; return '项目用途：防水板'; } }],
};
const rows = [{ ...record, purpose: '防水板' }, { ...record, id: 'batch.xlsx|sheet|4', purpose: '螺丝' }];
const results = reviewPaymentImport(rows, [], [screenshot]);
assert.match(results[0].candidates[0].hint, /用途、项目或备注/);
assert.doesNotMatch(results[1].candidates[0].hint, /用途、项目或备注/);
assert.equal(textReads, 1, '一次清单核对应重用同一份凭证的文字');
console.log('付款清单预览、来源冲突、跨来源重复、多笔等额候选及历史状态保留测试通过');

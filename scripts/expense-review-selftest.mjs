import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {importExpenseWorkbook} from '../src/lib/expense-import.js';
import {invoiceProblems} from '../src/lib/invoice-review.js';
import {parsePaymentWorkbook,paymentDuplicate,paymentEvidenceCandidate,allocationKind} from '../src/lib/payment-records.js';
import {recordInvoices,missingReimbursementFields} from '../src/lib/invoice-ledger.js';
function workbook(rows){const w=XLSX.utils.book_new();XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'测试');return XLSX.write(w,{type:'array'});}
const n='26442000000000000001',bytes=workbook([['发票号码','金额','发票日期'],[n,100,'2026/6/1']]);
assert.equal(importExpenseWorkbook({},bytes).added,0);
assert.equal(importExpenseWorkbook({},bytes).unmatched,1);
const ledger={[n]:{key:n,number:n,total:100,date:'2026-06-01'}};
const r=importExpenseWorkbook(ledger,bytes,{period:'2026年二季度'});
assert.equal(r.ledger[n].reimbursement,'已报销');assert.equal(r.ledger[n].reimbursementDate,undefined);assert.equal(ledger[n].reimbursement,undefined);
assert.equal(importExpenseWorkbook({[n]:{...ledger[n],total:101}},bytes).conflicts,1);
assert.ok(invoiceProblems({number:n,date:'2026-06-01',seller:'卖方',type:'普票',total:100}).includes('缺少购买方'));
assert.throws(()=>recordInvoices({},[{fields:{number:n,total:100}}]),/复核/);
assert.ok(invoiceProblems({number:n,date:'2026-02-30',buyer:'买方',seller:'卖方',type:'普票',total:100}).includes('开票日期无效'));
const paymentBytes=workbook([['下单日期','收款名称','材料或费用名称','金额（元）','实付合计'],['2026-06-01','店铺','材料',54,74],['','','运费',20,'']]);
const p=parsePaymentWorkbook(paymentBytes,'样本.xlsx');assert.equal(p.length,1);assert.equal(p[0].total,74);assert.equal(p[0].purpose,'材料 / 运费');
const a={date:'2026-06-01',total:74,evidenceHash:'abc'};assert.ok(paymentDuplicate(a,{...a}));assert.ok(!paymentDuplicate(a,{...a,evidenceHash:'def'}));assert.ok(!paymentDuplicate(a,{...a,date:'2026-06-02'}));assert.ok(!paymentDuplicate({...a,evidenceHash:''},{...a,evidenceHash:''}));
assert.ok(paymentEvidenceCandidate(a,'2026-06-01_店铺_74.00元.png'));
assert.equal(allocationKind({payer:'个人'}),'个人报账');assert.equal(allocationKind({service:'汽油'}),'加油');
assert.deepEqual(missingReimbursementFields({payer:'个人',reimburser:'甲',purpose:'个人用品'}),[]);
console.log('报销核对、发票完整性、付款截图查重和费用归属测试通过');

assert.equal(p[0].lines.length,2);assert.equal(p[0].lines[1].lineAmount,20);
assert.equal(importExpenseWorkbook(r.ledger,bytes,{period:'2026年三季度'}).conflicts,1);

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import { parsePaymentWorkbook, paymentDate } from '../src/lib/payment-records.js';
import { reviewPaymentImport } from '../src/lib/payment-reconciliation.js';
import { planPaymentAttachments } from '../src/lib/payment-batch-matching.js';
const data=[['日期','收款名称','材料或费用名称','金额','记录类型','日期范围'],['2026-03-02','商户甲','保护膜',90,'',''],['','','运费',15,'',''],['','','独立空白行',8,'',''],['','燃气公司','燃气费',265,'阶段汇总','2026-03-02至2026-11-16'],['2026-03-03','商户乙','材料',30,'现金无凭证',''],['','合计','',400,'合计','']];
const ws=XLSX.utils.aoa_to_sheet(data);ws['!merges']=[{s:{r:1,c:0},e:{r:2,c:0}},{s:{r:1,c:1},e:{r:2,c:1}}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'清单');
const rows=parsePaymentWorkbook(XLSX.write(wb,{type:'array',bookType:'xlsx'}),'虚构.xlsx',{includeInvalid:true});
assert.equal(rows[0].total,105);assert.equal(rows[0].lines.length,2);assert.equal(rows[1].seller,'');assert.equal(rows[1].total,8);
const review=reviewPaymentImport(rows,[]);assert.equal(review[2].canImport,true);assert.equal(review[3].issues.some(x=>x.includes('凭证')),false);assert.equal(review[4].status,'统计汇总行');
assert.equal(paymentDate(46083),'2026-03-02');
const batches = XLSX.utils.book_new();
for (const name of ['归还垫付款甲', '归还垫付款乙']) {
  const table = XLSX.utils.aoa_to_sheet([
    ['日期','收款名称','材料或费用名称','金额','实付合计','附件'],
    ['2026-03-02','','旧费用一',90,105,'./凭证/同一张.png'],
    ['2026-03-03','','旧费用二',15,'',''],
    ['2026-03-04','独立收款人','独立付款',23,'',''],
  ]);
  table['!merges'] = [{ s: { r: 1, c: 4 }, e: { r: 2, c: 4 } }];
  XLSX.utils.book_append_sheet(batches, table, name);
}
XLSX.utils.book_append_sheet(batches, XLSX.utils.aoa_to_sheet([
  ['日期','名字','金额'], ['2026-03-03','收款人甲',50],
]), '项目送礼金额');
const grouped = parsePaymentWorkbook(XLSX.write(batches,{type:'array'}),'季度/清单.xlsx',{includeInvalid:true});
assert.deepEqual(grouped.map(row => [row.recordType,row.firstRow,row.lastRow,row.total]), [
  ['报销批次',2,3,105],['',4,4,23],['报销批次',2,3,105],['',4,4,23],['现金无凭证',2,2,50],
]);
assert.notEqual(grouped[0].id,grouped[2].id);
assert.equal(grouped[0].dateRange,'2026-03-02至2026-03-03');
assert.equal(reviewPaymentImport(grouped,[])[0].canImport,false);
assert.ok(reviewPaymentImport(grouped,[],[{fields:{kind:'payment',seller:grouped[0].seller,total:105,date:'2026-03-04'}}])[0].candidates.length);
const shared = {paths:['季度/凭证/同一张.png'],file:{name:'同一张.png'},fields:{kind:'payment'}};
const plan = planPaymentAttachments(grouped,[shared]);
for (const row of [grouped[0],grouped[2]]) {
  assert.equal(plan.get(row.id).choices.length,0);
  assert.ok(plan.get(row.id).notes.some(note => note.includes('多笔付款')));
}
console.log('合并付款、空白行、阶段汇总、现金、统计行及日期测试通过');

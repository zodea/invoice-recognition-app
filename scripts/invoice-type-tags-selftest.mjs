import assert from 'node:assert/strict';
import { invoiceTypeTags } from '../src/lib/invoice-type-tags.js';
const labels = entry => invoiceTypeTags(entry).map(t=>t.label);
assert.deepEqual(labels({type:'数电发票（普通发票）',typeLabel:'普通发票'}),['数电','普票']);
assert.deepEqual(labels({type:'数电发票（通行费发票）',typeLabel:'普通发票'}),['数电','通行费','普票']);
assert.deepEqual(labels({type:'数电发票（增值税专用发票）'}),['数电','专票']);
assert.deepEqual(labels({type:'未分类的新票种'}),['未分类的新票种']);
assert.deepEqual(labels({}),[]);
console.log('发票类型标签简化及去重验证通过');

const { deductionDisplay, invoiceStatusTags } = await import('../src/lib/invoice-status-display.js');
assert.deepEqual(deductionDisplay({selectionTime:'2026-05-18 11:40:39',officialSelection:'未勾选'}),{label:'2026-05-18 11:40:39',hasTime:true,title:'已抵扣'});
assert.equal(deductionDisplay({verified:true}).label,'已抵扣');
assert.equal(deductionDisplay({selectionTime:'—',officialSelection:'未勾选'}).label,'未勾选');
assert.deepEqual(invoiceStatusTags({invoiceStatus:'已红冲-全额'}).map(t=>t.label),['已冲红']);
assert.deepEqual(invoiceStatusTags({invoiceStatus:'正常',total:-100}).map(t=>t.label),['红字发票']);
assert.deepEqual(invoiceStatusTags({invoiceStatus:'正常',total:100}).map(t=>t.label),['正常']);
assert.deepEqual(invoiceStatusTags({invoiceStatus:'部分红冲'}).map(t=>t.label),['部分冲红']);
console.log('抵扣时间与发票状态标签验证通过');

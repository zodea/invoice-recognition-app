import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { moneyCents, withProjectAllocation, projectAllocationState, projectExpenseRows, projectNames } from '../src/lib/invoice-allocation.js';
import { expenseSummary } from '../src/lib/expense-summary.js';
import { buildHistoryReportBytes, importInputInvoiceRows, missingReimbursementFields, ledgerStats, saveLedger, loadLedger } from '../src/lib/invoice-ledger.js';
import { importExpenseWorkbook } from '../src/lib/expense-import.js';

const entry = { key: '26310000000000000688', number: '26310000000000000688', date: '2026-11-08', seller: '示例建材', buyer: '示例建筑', total: 12000, tax: 1000, validTax: 900, project: '滨江', allocation: '指定工地', reimbursement: '已报销', reimbursementDate: '2026-11-09', purpose: '材料', reimburser: '甲' };
const multi = withProjectAllocation(entry, { mode: 'multi', rows: [{project:'滨江',total:'6000.00',remark:'主体材料'}, {project:'城南',total:'4000'}, {project:'科创园',total:2000}] });
assert.equal(multi.project, '');
assert.equal(projectNames(multi), '滨江 / 城南 / 科创园');
assert.equal(projectAllocationState(multi).complete, true);
assert.equal(entry.project, '滨江');
for (const key of ['number','total','tax','validTax','reimbursement','reimbursementDate']) assert.equal(multi[key], entry[key]);
assert.deepEqual(missingReimbursementFields(multi), []);
assert.equal(ledgerStats({[multi.key]:multi}).total, 1);
assert.equal(moneyCents('0.29'), 29);
for (const invalid of ['', ' ', null, NaN, Infinity, '1.001', '1e3', '1,000', 'abc']) assert.equal(moneyCents(invalid), null);
for (const rows of [
  [{project:'滨江',total:12000.01}],
  [{project:'滨江',total:6000},{project:'滨江',total:6000}],
  [{project:'',total:12}],
  [{project:'滨江',total:''}],
  [{project:'滨江',total:-12}],
  [{project:'滨江',total:'0.001'}],
]) assert.throws(() => withProjectAllocation(entry, {mode:'multi',rows}));
const partial = withProjectAllocation(entry, {mode:'multi',rows:[{project:'滨江',total:6000}]});
assert.equal(projectAllocationState(partial).remaining,600000);
assert.equal(projectAllocationState(partial).label,'待分配');
assert.ok(missingReimbursementFields(partial).includes('工地分配未完成'));
assert.equal(projectExpenseRows(partial).reduce((sum,row)=>sum+row.total,0),12000);
assert.equal(projectExpenseRows(partial)[1].project,'待分配');
const pending = withProjectAllocation(entry,{mode:'multi',rows:[]});
assert.deepEqual(projectExpenseRows(pending).map(row=>[row.project,row.total]),[['待分配',12000]]);
assert.deepEqual(projectExpenseRows(entry).map(row=>[row.project,row.total]),[['滨江',12000]]);
const single = withProjectAllocation(multi,{mode:'single',project:'城南'});
assert.equal(single.allocation,'指定工地');
assert.equal(single.project,'城南');
assert.deepEqual(single.projectAllocations,[]);
assert.throws(()=>withProjectAllocation(entry,{mode:'single',project:''}));
const red = withProjectAllocation({...entry,total:-0.3},{mode:'multi',rows:[{project:'滨江',total:-0.1},{project:'城南',total:-0.2}]});
assert.equal(projectAllocationState(red).complete,true);
assert.throws(()=>withProjectAllocation({...entry,total:-100},{mode:'multi',rows:[{project:'滨江',total:10}]}));
const zero = withProjectAllocation({...entry,total:0},{mode:'multi',rows:[{project:'滨江',total:0}]});
assert.equal(projectAllocationState(zero).complete,true);
const changedTotal={...multi,total:5000};
assert.ok(projectAllocationState(changedTotal).errors.length);
assert.equal(projectExpenseRows(changedTotal).length,1);
assert.equal(projectExpenseRows(changedTotal)[0].project,'待分配');

const summary = expenseSummary([multi]);
assert.deepEqual(summary.map(row=>row.total),[6000,4000,2000]);
assert.deepEqual(summary.map(row=>row.reimbursed),[6000,4000,2000]);
assert.equal(summary.reduce((sum,row)=>sum+row.total,0),12000);
assert.equal(expenseSummary([partial]).reduce((sum,row)=>sum+row.total,0),12000);
assert.equal(expenseSummary([entry])[0].total,12000);
assert.equal(expenseSummary([{...entry,allocation:'加油'}])[0].project,'加油');

const storage=new Map();
globalThis.localStorage={getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)};
saveLedger({[multi.key]:multi});
assert.deepEqual(loadLedger()[multi.key],multi);
const bytes=buildHistoryReportBytes({[multi.key]:multi});
const workbook=XLSX.read(bytes,{type:'array'});
const original=XLSX.utils.sheet_to_json(workbook.Sheets['历史发票台账'],{header:1});
assert.equal(original[1][original[0].indexOf('价税合计')],12000);
assert.equal(original[1][original[0].indexOf('有效抵扣税额')],900);
const allocationRows=XLSX.utils.sheet_to_json(workbook.Sheets['工地分配明细'],{header:1});
assert.equal(allocationRows.length,4);
assert.equal(allocationRows.slice(1).reduce((sum,row)=>sum+row[5],0),12000);
const reimport=importInputInvoiceRows({[multi.key]:multi},[['发票号码','开票日期','销售方','购买方','价税合计'],[multi.number,multi.date,multi.seller,multi.buyer,12000]]);
assert.deepEqual(reimport.ledger[multi.key].projectAllocations,multi.projectAllocations);
const report=(project)=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['发票号码','发票日期','金额','工地'],[multi.number,multi.date,12000,project]]),'报销');
  return XLSX.write(wb,{type:'array'});
};
assert.equal(importExpenseWorkbook({[multi.key]:multi},report('滨江')).conflicts,1);
const imported=importExpenseWorkbook({[multi.key]:multi},report(''),{period:'2026年四季度'});
assert.equal(imported.conflicts,0);
assert.deepEqual(imported.ledger[multi.key].projectAllocations,multi.projectAllocations);
assert.equal(imported.ledger[multi.key].project,'');
console.log('多工地金额分配、待分配、红字、持久化、费用汇总、导出及重复导入测试通过');

import assert from 'node:assert/strict';
import {expenseOptions,splitTags} from '../src/lib/expense-options.js';
const options=expenseOptions({projects:['工地甲'],people:['张三'],tags:['待补资料'],paymentMethods:['微信']},[{project:'工地乙',reimburser:'李四',payment:'公账支付',purpose:'采购材料',tags:'待补资料、紧急; 紧急'}]);
assert.deepEqual(new Set(options.project),new Set(['工地甲','工地乙']));
assert.deepEqual(new Set(options.reimburser),new Set(['张三','李四']));
assert.deepEqual(options.tags,['待补资料','紧急']);
assert.ok(options.payment.includes('公账支付'));
assert.ok(options.payment.includes('微信'));
assert.deepEqual(splitTags(' A，A;B、C'),['A','B','C']);
console.log('档案与历史候选合并、标签解析和旧付款方式保留验证通过');

const XLSX = await import('xlsx');
const {importInputInvoiceWorkbookBytes}=await import('../src/lib/invoice-ledger.js');
const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['发票号码','开票日期','销方名称','税额','有效抵扣税额'],['26442000000000000001','2026-11-01','测试公司',13,''],['26442000000000000002','2026-11-01','测试公司',13,8]]),'发票信息');
const imported=importInputInvoiceWorkbookBytes({},XLSX.write(wb,{type:'array'})).ledger;
assert.equal(imported['26442000000000000001'].validTax,undefined);
assert.equal(imported['26442000000000000002'].validTax,8);
console.log('有效抵扣税额仅导入匹配、不按票面税额补算验证通过');

import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import {parsePaymentWorkbook, paymentDate} from '../src/lib/payment-records.js';
import {reviewPaymentImport} from '../src/lib/payment-reconciliation.js';
function book(rows,merges=[],date1904=false){const wb=XLSX.utils.book_new(); const ws=XLSX.utils.aoa_to_sheet(rows);ws['!merges']=merges;XLSX.utils.book_append_sheet(wb,ws,'虚构');wb.Workbook={WBProps:{date1904}};return XLSX.write(wb,{bookType:'xlsx',type:'array'});}
const headers=['日期','收款名称','材料或费用名称','金额','实付金额'];
const merge=[XLSX.utils.decode_range('A2:A3'),XLSX.utils.decode_range('B2:B3')];
let rows=parsePaymentWorkbook(book([headers,[46083,'商户','保护膜',90,105],['','','运费',15,'']],merge),'样例.xlsx');
assert.equal(rows[0].date,'2026-03-02');assert.equal(rows[0].total,105);assert.equal(rows[0].lines.length,2);
rows=parsePaymentWorkbook(book([headers,[46083,'商户','材料',90,105],['','','运费',15,106]],merge),'样例.xlsx');
assert.ok(rows[0].importWarnings.some(w=>w.includes('不一致')));assert.equal(reviewPaymentImport(rows,[])[0].canImport,false);
rows=parsePaymentWorkbook(book([headers,[46083,'商户','材料',90,'错误金额']]),'样例.xlsx');assert.equal(rows[0].total,'');assert.equal(reviewPaymentImport(rows,[])[0].canImport,false);
rows=parsePaymentWorkbook(book([headers,[44621,'商户','材料',90,'']],[],true),'1904.xlsx');assert.equal(rows[0].date,'2026-03-02');
const three=[XLSX.utils.decode_range('A2:A4'),XLSX.utils.decode_range('B2:B4')];
rows=parsePaymentWorkbook(book([headers,['2026-03-02','黄某','明细甲',8,''],['','','明细乙',10,''],['','','明细丙',11,''],['','','独立行',5,'']],three),'虚构.xlsx');
assert.equal(rows[0].total,29);assert.equal(rows[0].lines.length,3);assert.equal(rows[1].seller,'');assert.equal(rows[1].total,5);
assert.equal(paymentDate(new Date(2026,2,2)),'2026-03-02');assert.equal(paymentDate('2026-02-30'),'');
console.log('Excel 序列日期、1904 日期系统、实际付款金额异常与冲突保护通过');

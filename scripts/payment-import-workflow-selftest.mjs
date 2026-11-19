import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import { parsePaymentWorkbook } from '../src/lib/payment-records.js';
import { reviewPaymentImport, paymentEvidenceCandidates } from '../src/lib/payment-reconciliation.js';
import { paymentRange, reconcileEvidenceTransactions } from '../src/lib/payment-transactions.js';
import { needsPaymentEvidence, countPaymentExpense } from '../src/lib/payment-store.js';

function workbook(format, epoch=false) {
  const book=XLSX.utils.book_new(), sheet=XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.sheet_add_aoa(sheet,[
    ['付款日期','付款人','收款人','用途','数量','单价','明细金额','实付金额','记录类型','日期范围'],
    [epoch?44621:46083,'经办甲','商户甲','保护膜',2,45,90,105],['','','','运费',1,15,15],
    [epoch?44621:46083,'经办甲','商户乙','材料',1,29,29,29.01],[],
    ['','','商户丙','燃气费','','',265,'','阶段汇总','至2026-11-16'],
    ['2026年3月2日','','商户丁','备用金','','',9,'','现金无凭证']
  ],{origin:'C3'});
  sheet.C4.z='yyyy-mm-dd'; sheet['!merges']=['C4:C5','D4:D5','E4:E5'].map(XLSX.utils.decode_range);
  if(format==='xlsx') sheet.C6={t:'d',v:new Date('2026-03-02T00:00:00.000Z'),z:'yyyy-mm-dd'};
  XLSX.utils.book_append_sheet(book,sheet,'明细');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['日期','姓名','金额'],['2026-03-02','商户甲',105]]),'费用汇总表');
  book.Workbook={WBProps:{date1904:epoch}};
  return XLSX.write(book,{type:'array',bookType:format,cellDates:true});
}
const originalTZ=process.env.TZ;
try {
  const fixtures=[workbook('xlsx'),workbook('xls'),workbook('xlsx',true),workbook('xls',true)];
  for(const tz of ['Asia/Shanghai','UTC','America/Los_Angeles']){
    process.env.TZ=tz;
    for(const bytes of fixtures){
      const rows=parsePaymentWorkbook(bytes,'示例');
      assert.equal(rows.length,5); assert.equal(rows[0].date,'2026-03-02',tz);
      assert.equal(rows[1].date,'2026-03-02',tz); assert.equal(rows[0].total,105); assert.equal(rows[0].lines.length,2);
      assert.equal(rows[1].total,29.01);assert.equal(rows[1].lineTotal,29);
      assert.equal(reviewPaymentImport(rows,[])[1].canImport,false,'一分钱差异必须核对');
      assert.equal(rows[2].date,'');assert.equal(paymentRange(rows[2].dateRange).label,'未知至2026-11-16');
      assert.equal(needsPaymentEvidence(rows[3]),false);assert.equal(countPaymentExpense(rows[3]),true);assert.equal(countPaymentExpense({...rows[3],duplicateOf:'original'}),false);assert.equal(reviewPaymentImport(rows,[])[4].canImport,false);
    }
  }
} finally {if(originalTZ===undefined)delete process.env.TZ;else process.env.TZ=originalTZ;}
const payment={id:'示例|清单|4',date:'2026-03-02',total:105,seller:'样例商户',note:'蓝色保护膜'};
const twin={...payment,id:'示例|清单|7'};
assert.equal(reviewPaymentImport([twin],[payment])[0].canImport,false);
assert.equal(reviewPaymentImport([twin],[payment],[],'',{confirmed:[twin.id]})[0].canImport,true);
assert.equal(reviewPaymentImport([payment],[payment],[],'',{confirmed:[payment.id]})[0].canImport,false);
const paid={...payment,kind:'payment',direction:'expense',paymentStatus:'success',transactionId:'TX000111',orderId:'OR000100'};
const files=[{name:'raw123',fields:paid,pages:[{text:'蓝色保护膜'}]},{name:'raw444',fields:{kind:'order',orderId:'OR000100',total:''}}];
assert.equal(paymentEvidenceCandidates(payment,files).length,2);
assert.equal(reconcileEvidenceTransactions([paid,{...paid,transactionId:''}],105).matches,true);
assert.equal(reconcileEvidenceTransactions([paid,{...paid,transactionId:'TX000222'}],210).unique.length,2);
assert.equal(reconcileEvidenceTransactions([paid],105,'至2026-03-01').matches,false);
assert.equal(paymentEvidenceCandidates(payment,[{name:'2026-03-02-样例商户-105元.png',fields:{}}]).length,0);
console.log('两种工作簿、两种日期系统、ISO 日期单元格、三个时区、统计页、分币冲突、订单补充与人工区分同额付款通过');

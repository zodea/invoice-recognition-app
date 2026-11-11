import assert from 'node:assert/strict';
import { invoiceFolderParts, writeInvoiceExportPackage } from '../src/lib/invoice-export-package.js';
import { invoiceProblems } from '../src/lib/invoice-review.js';
for (const [docType, folder] of [['行程单','行程单'],['医疗票据','医疗票据']]) {
  for (const buyer of ['', '测试购买方']) {
    for (const dims of [[], ['buyer'], ['buyer','type'], ['type','buyer'], ['seller','date','buyer']]) {
      assert.deepEqual(invoiceFolderParts({fields:{docType,buyer,taxKind:'普通发票'}}, dims), [folder]);
    }
  }
}
assert.deepEqual(invoiceFolderParts({fields:{docType:'增值税发票',buyer:'测试公司',taxKind:'普通发票'}},['buyer','type']),['测试公司','普通发票']);
assert.deepEqual(invoiceFolderParts({fields:{docType:'增值税发票'}},['buyer']),['未识别购买方']);
assert.deepEqual(invoiceProblems({docType:'行程单',date:'2026-11-09',seller:'出行公司',total:100}),[]);
assert.deepEqual(invoiceProblems({docType:'医疗票据',number:'12345678',date:'2026-11-09',seller:'医院',total:100}),[]);
assert.ok(invoiceProblems({docType:'增值税发票',number:'12345678',date:'2026-11-09',seller:'卖方',total:100}).includes('缺少购买方'));
console.log('行程单、医疗票据直接按类型导出及完整性校验通过');

// Exercise the actual browser export writer without writing temporary files.
const written=[];
function directory(path=[]){return {
 async getDirectoryHandle(name){return directory([...path,name]);},
 async getFileHandle(name, options={}){if(!options.create)throw new Error('NotFound');return {async createWritable(){return {async write(){written.push([...path,name]);},async close(){}};}};}
};}
await writeInvoiceExportPackage([
 {name:'trip.pdf',blob:new Blob(['trip']),fields:{docType:'行程单',date:'2026-11-09',total:100,seller:'出行公司'}},
 {name:'medical.pdf',blob:new Blob(['medical']),fields:{docType:'医疗票据',date:'2026-11-09',total:50,seller:'医院'}}
],directory(),{dims:['buyer','type']});
assert.deepEqual(written.map(parts=>parts.slice(1,-1)),[['行程单'],['医疗票据']]);
assert.ok(written.every(parts=>!parts.includes('未识别购买方')));
console.log('实际导出写入路径验证通过');

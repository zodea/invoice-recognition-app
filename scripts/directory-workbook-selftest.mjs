import assert from 'node:assert/strict';
import * as XLSX from 'xlsx/xlsx.mjs';
import { archiveKinds, exportDirectoryWorkbook, readDirectoryWorkbook, mergeDirectoryWorkbook } from '../src/lib/directory-workbook.js';
import { expenseSummary } from '../src/lib/expense-summary.js';
import { searchSupplementInvoices, supplementInvoiceCandidates } from '../src/lib/invoice-supplements.js';

const blank = () => ({ ...Object.fromEntries(Object.keys(archiveKinds).map(k => [k, []])), rules: [], deletedArchives: [] });
const original = blank();
for (const key of Object.keys(archiveKinds)) original[key] = ['001'];
original.rules = ['001', '002'].map(project => ({ seller: '示例厂家', buyer: '001', project }));
original.deletedArchives = [{ kind: 'projects', value: '002', deletedAt: '2026-06-01T00:00:00.000Z' }];
const imported = readDirectoryWorkbook(exportDirectoryWorkbook(original));
const base = blank();
assert.deepEqual(mergeDirectoryWorkbook(base, imported).next, original);
assert.deepEqual(base, blank());
const alias = { name: '测试简称', kind: 'buyers', target: '001' };
const deletedAlias = { name: '旧工地名', kind: 'projects', target: '001' };
const withAliases = { ...original, aliases: [alias], deletedArchives: [
  ...original.deletedArchives, { kind: 'aliases', value: deletedAlias.name, alias: deletedAlias, deletedAt: '2026-06-01T00:00:00.000Z' },
] };
const aliasImport = readDirectoryWorkbook(exportDirectoryWorkbook(withAliases));
assert.deepEqual(mergeDirectoryWorkbook(blank(), aliasImport).next, withAliases);
assert.equal(mergeDirectoryWorkbook(withAliases, aliasImport).changed, 0);
assert.equal(mergeDirectoryWorkbook(original, imported).changed, 0);
base.deletedArchives = [{ ...original.deletedArchives[0], value: '001' }];
base.projects = ['002'];
const restored = mergeDirectoryWorkbook(base, imported);
assert.equal(restored.counts.restored, 1);
assert.deepEqual(restored.next.projects, ['002', '001']);
assert.equal(restored.next.deletedArchives.length, 0);

function bytes(name, rows) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}
assert.deepEqual(readDirectoryWorkbook(bytes('基础档案', [['档案名称','档案类型'],['005','工地']])).archives, [{ kind:'projects',value:'005' }]);
assert.throws(() => readDirectoryWorkbook(bytes('票据', [['档案类型','档案名称']])), /未找到/);
assert.throws(() => readDirectoryWorkbook(bytes('基础档案', [['工地']])), /缺少表头/);
assert.throws(() => readDirectoryWorkbook(bytes('基础档案', [['档案类型','档案名称'],['其他','A']])), /第 2 行/);
const split = { allocation:'多工地分配', total:50, reimbursement:'已报销', projectAllocations:[{project:'A',total:30},{project:'B',total:20}] };
const single = { allocation:'油费',project:'A',total:8 };
assert.deepEqual(expenseSummary([split],false,{ groupBy:'allocation' }).map(r=>[r.count,r.total,r.reimbursed]), [[1,50,50]]);
assert.deepEqual(expenseSummary([split,single],false,{ groupBy:'project',projectFilter:'A' }).map(r=>[r.count,r.total,r.reimbursed]), [[2,38,30]]);
assert.deepEqual(expenseSummary([split,single],false,{ groupBy:'both',allocationFilter:'油费' }).map(r=>[r.project,r.total]), [['A',8]]);

const ledger = { a:{number:'00120800', date:'2026-07-08',seller:'示例车队',total:40}, b:{type:'行程单',number:'0000'} };
assert.equal(searchSupplementInvoices(ledger, '车队')[0].key,'a');
assert.equal(searchSupplementInvoices(ledger, '1208')[0].key,'a');
assert.equal(searchSupplementInvoices(ledger, '').length,1);
assert.equal(supplementInvoiceCandidates({fields:{},rawText:'发 票 号 码 0 0 1 2 0 8 0 0'},ledger)[0].strong,true);
assert.equal(supplementInvoiceCandidates({fields:{},rawText:'订单号 00120800'},ledger).length,0);
console.log('基础档案往返、费用分组及关联主票搜索通过');

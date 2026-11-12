import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.BROWSER_TEST_PLAYWRIGHT || 'playwright');
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(new URL('../package.json',import.meta.url)),{PDFDocument,StandardFonts}=require('pdf-lib');
const pdf=await PDFDocument.create();const p=pdf.addPage([842,595]);p.drawText('Synthetic invoice preview - no private data',{x:40,y:540,size:18,font:await pdf.embedFont(StandardFonts.Helvetica)});const bytes=[...await pdf.save()];
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_TEST_EXECUTABLE});const context=await browser.newContext({viewport:{width:1500,height:1050}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{localStorage.setItem('expenseDirectory.v1',JSON.stringify({buyers:['测试购买方公司'],projects:['测试工地甲','测试工地乙'],allocations:['公司开支'],rules:[]}));});
try {
await page.goto(process.env.BROWSER_TEST_URL || 'http://127.0.0.1:5173');
await page.waitForFunction(()=>window.__inv?.invoiceStore);
await page.evaluate(async bytes=>{
 const {invoiceStore:s}=await Promise.resolve(window.__inv);const {saveLedger}=await import('/src/lib/invoice-ledger.js');const {saveLedgerAttachment}=await import('/src/lib/ledger-attachments.js');
 const a={key:'26990000000000000001',number:'26990000000000000001',date:'2026-11-01',buyer:'测试购买方公司',seller:'测试出行公司',type:'普通发票',docType:'增值税发票',amount:100,tax:6,total:106,reimbursement:'未核对'};const b={...a,key:'26990000000000000002',number:'26990000000000000002',amount:200,tax:12,total:212};s.ledger={[a.key]:a,[b.key]:b};saveLedger(s.ledger);
 const file=new File([new Uint8Array(bytes)],'fixture.pdf',{type:'application/pdf'});await saveLedgerAttachment(a.key,file);
 s.invoices.push({id:'draft',name:'draft.pdf',blob:file,fields:{...a,number:'26990000000000000003',seller:'',amount:50,tax:3,total:53},status:'done',renderedPages:[],pages:[],include:false,history:{},rotation:0,pageCount:1});s.selectedId='draft';
},bytes);
await page.waitForTimeout(300);
const sellerInput=page.locator('.invoice-detail .field-label').filter({hasText:'销售方'}).locator('input').first();await sellerInput.fill('测试商户',{timeout:5000});await sellerInput.blur();
await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000003']),undefined,'补齐字段不可自动入账');
await page.getByRole('button',{name:'确认保存',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000003']);
await page.evaluate(async bytes=>{const {invoiceStore:s}=await Promise.resolve(window.__inv);s.invoices.push({id:'trip',name:'2026-11-01-测试出行公司-106.00元-行程单.pdf',blob:new File([new Uint8Array(bytes)],'trip.pdf',{type:'application/pdf'}),fields:{docType:'行程单',type:'行程单',date:'2026-11-01',total:106,buyer:'',seller:'',number:''},status:'done',renderedPages:[],pages:[],include:false,history:{},rotation:0,pageCount:1});s.selectedId='trip';},bytes);
await page.getByRole('button',{name:'保存附件并自动匹配',exact:true}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('invoiceSupplements.v1')||'[]')[0]?.ledgerKey==='26990000000000000001');
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000001'].total),106);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('paymentRecords.v1')||'[]').length),0);
await page.getByRole('tab',{name:/历史进项台账/}).click();await page.getByLabel('按金额查询发票').fill('106.00');await page.waitForTimeout(120);assert.equal(await page.locator('.ledger-table tbody tr').count(),1);
await page.getByLabel('按金额查询发票').fill('');await page.getByLabel('仅看有附件').check();await page.waitForTimeout(120);assert.equal(await page.locator('.ledger-table tbody tr').count(),1);
await page.getByRole('button',{name:/查看 .* 的附件/}).click();await page.waitForSelector('.preview-page img');await page.waitForFunction(()=>document.querySelector('.preview-page img')?.complete);
const preserved=await page.evaluate(async()=>{const store=(await Promise.resolve(window.__inv)).invoiceStore;const records=[];const observer=new MutationObserver(()=>records.push(document.querySelectorAll('.preview-page img').length));observer.observe(document.querySelector('.preview-scroll'),{childList:true,subtree:true});store.attachmentVersion++;await new Promise(r=>setTimeout(r,800));observer.disconnect();return records;});assert.ok(preserved.every(n=>n>0),'正在查看的原件在无关状态刷新时不应清空：'+preserved);
const frames=await page.evaluate(async()=>{const samples=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const el=document.querySelector('.preview-page img'),rect=el?.getBoundingClientRect();if(rect&&el.complete)samples.push({width:rect.width,height:rect.height,top:rect.top});}return samples;});
const drift=Math.max(...frames.map(f=>f.height))-Math.min(...frames.map(f=>f.height));console.log('Preview layout drift(px):',drift,'frames',frames.length);if(process.env.BROWSER_TEST_SCREENSHOT)await page.screenshot({path:process.env.BROWSER_TEST_SCREENSHOT});
await page.getByRole('button',{name:'关闭详情',exact:true}).last().click();
const XLSX=require('xlsx'),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['发票号码','发票日期','价税合计','购买方','销售方','费用归属','使用工地','费用归属人','归属备注'],['26990000000000000001','2026-11-01',106,'测试购买方公司','测试出行公司','指定工地','测试工地甲','测试人','虚构归属测试']]),'发票归属');
await page.getByRole('button',{name:'批量导入归属',exact:true}).click();await page.locator('.assignment-dialog input[type=file]').setInputFiles({name:'synthetic-assignment.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))});await page.getByRole('button',{name:'确认更新所选 1 条归属',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000001'].project),undefined,'导入预览不写归属');await page.getByRole('button',{name:'确认更新所选 1 条归属',exact:true}).click();
const applied=await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000001']);assert.equal(applied.project,'测试工地甲');assert.equal(applied.total,106);assert.equal(applied.reimbursement,'未核对');await page.locator('.assignment-dialog').getByRole('button',{name:'关闭',exact:true}).click();
await page.getByRole('tab',{name:/送货单/}).click();await page.getByLabel('搜索项目').fill('测试工地甲');assert.equal(await page.getByRole('button',{name:'选择项目 测试工地甲',exact:true}).count(),1);await page.getByRole('button',{name:'收起项目列表',exact:true}).click();assert.equal(await page.getByRole('button',{name:'展开项目列表',exact:true}).count(),1);
assert.deepEqual(errors,[]);console.log('BROWSER PASS: assignment preview/apply without financial changes, explicit save, no-cost automatic supplements, amount filter, direct attachment preview, searchable/collapsible projects; no page errors');
} finally { await browser.close(); }



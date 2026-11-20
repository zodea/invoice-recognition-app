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
await page.locator('.invoice-detail').getByLabel('使用工地').selectOption('测试工地乙');
await page.getByRole('button',{name:/确认保存可入账发票/}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000003']);
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000003'].project),'测试工地乙');
assert.equal(await page.locator('.invoice-detail').getByLabel('使用工地').inputValue(),'测试工地乙','入账后当前票仍留在识别列表');
await page.evaluate(async bytes=>{const {invoiceStore:s}=await Promise.resolve(window.__inv);s.invoices.push({id:'trip',name:'2026-11-01-测试出行公司-106.00元-行程单.pdf',blob:new File([new Uint8Array(bytes)],'trip.pdf',{type:'application/pdf'}),fields:{docType:'行程单',type:'行程单',date:'2026-11-01',total:106,buyer:'',seller:'',number:''},status:'done',renderedPages:[],pages:[],include:false,history:{},rotation:0,pageCount:1});s.selectedId='trip';},bytes);
await page.evaluate(()=>window.__inv.invoiceActions.recognizeAll());await page.waitForFunction(()=>JSON.parse(localStorage.getItem('invoiceSupplements.v1')||'[]')[0]?.ledgerKey==='26990000000000000001');
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000001'].total),106);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('paymentRecords.v1')||'[]').length),0);
await page.getByRole('tab',{name:/历史进项台账/}).click();await page.getByLabel('按金额查询发票').fill('106.00');await page.waitForTimeout(120);assert.equal(await page.locator('.ledger-table tbody tr').count(),1);
await page.getByLabel('按金额查询发票').fill('');await page.getByLabel('仅看有附件').check();await page.waitForTimeout(120);assert.equal(await page.locator('.ledger-table tbody tr').count(),1);
await page.getByRole('button',{name:/查看 .* 的附件/}).click();await page.waitForSelector('.preview-page img');await page.waitForFunction(()=>document.querySelector('.preview-page img')?.complete);
const preserved=await page.evaluate(async()=>{const store=(await Promise.resolve(window.__inv)).invoiceStore;const records=[];const observer=new MutationObserver(()=>records.push(document.querySelectorAll('.preview-page img').length));observer.observe(document.querySelector('.preview-scroll'),{childList:true,subtree:true});store.attachmentVersion++;await new Promise(r=>setTimeout(r,800));observer.disconnect();return records;});assert.ok(preserved.every(n=>n>0),'正在查看的原件在无关状态刷新时不应清空：'+preserved);
const frames=await page.evaluate(async()=>{const samples=[];for(let i=0;i<90;i++){await new Promise(requestAnimationFrame);const el=document.querySelector('.preview-page img'),rect=el?.getBoundingClientRect();if(rect&&el.complete)samples.push({width:rect.width,height:rect.height,top:rect.top});}return samples;});
const drift=Math.max(...frames.map(f=>f.height))-Math.min(...frames.map(f=>f.height));console.log('Preview layout drift(px):',drift,'frames',frames.length);if(process.env.BROWSER_TEST_SCREENSHOT)await page.screenshot({path:process.env.BROWSER_TEST_SCREENSHOT});
await page.getByRole('button',{name:'关闭详情',exact:true}).last().click();
await page.getByLabel('仅看有附件').uncheck();
await page.evaluate(() => {
  const s=window.__inv.invoiceStore, template=s.ledger['26990000000000000001'];
  for(let i=0;i<20;i++){const key='269911111111111111'+String(i).padStart(2,'0');s.ledger[key]={...template,key,number:key,date:'2026-10-01',supplementHashes:[]};}
});
await page.getByLabel('选择发票 26990000000000000001',{exact:true}).check();
await page.locator('.ledger-footer').getByRole('button',{name:'下一页'}).click();
await page.locator('td.sticky-action input').first().check();
await page.getByRole('button',{name:'查看所选',exact:true}).click();
await page.getByText('所选第 1 / 2 张').waitFor();
await page.getByRole('button',{name:'下一张',exact:true}).click();
await page.getByText('所选第 2 / 2 张').waitFor();
await page.getByRole('button',{name:'关闭详情',exact:true}).last().click();
await page.locator('.ledger-delete-tools').getByRole('button',{name:'打印预览',exact:true}).click();
const print=page.getByRole('dialog',{name:'所选发票打印预览'});
await print.getByRole('img',{name:'打印排版第 1 页'}).waitFor();
await print.getByText('有 1 张未排入打印，查看原因').click();
assert.equal(await print.getByRole('button',{name:'打印 1 张发票'}).isEnabled(),true);
await print.getByRole('combobox').selectOption('4');
await print.getByRole('img',{name:'打印排版第 1 页'}).waitFor();
await print.getByRole('button',{name:'关闭',exact:true}).click();
await page.getByText('已选 2 张',{exact:true}).waitFor();
await page.getByRole('tab',{name:'基础档案'}).click();
assert.ok((await page.getByRole('heading',{name:'基础档案',exact:true}).boundingBox()).y<150,'基础档案无空白占位');
await page.getByRole('tab',{name:/历史进项台账/}).click();
const XLSX=require('xlsx'),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['发票号码','发票日期','价税合计','购买方','销售方','费用归属','使用工地','费用归属人','归属备注'],['26990000000000000001','2026-11-01',106,'测试购买方公司','测试出行公司','指定工地','测试工地甲','测试人','虚构归属测试']]),'发票归属');
await page.getByRole('button',{name:'批量导入归属',exact:true}).click();await page.locator('.assignment-dialog input[type=file]').setInputFiles({name:'synthetic-assignment.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}))});await page.getByRole('button',{name:'确认更新所选 1 条归属',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000001'].project),undefined,'导入预览不写归属');await page.getByRole('button',{name:'确认更新所选 1 条归属',exact:true}).click();
const applied=await page.evaluate(()=>JSON.parse(localStorage.getItem('invoiceLedger.v1'))['26990000000000000001']);assert.equal(applied.project,'测试工地甲');assert.equal(applied.total,106);assert.equal(applied.reimbursement,'未核对');await page.locator('.assignment-dialog').getByRole('button',{name:'关闭',exact:true}).click();
await page.getByRole('tab',{name:/送货单/}).click();await page.getByLabel('搜索项目').fill('测试工地甲');assert.equal(await page.getByRole('button',{name:'选择项目 测试工地甲',exact:true}).count(),1);await page.getByRole('button',{name:'收起项目列表',exact:true}).click();assert.equal(await page.getByRole('button',{name:'展开项目列表',exact:true}).count(),1);
const linked = await page.evaluate(async () => {
  const {invoiceStore:s, invoiceActions:a} = window.__inv;
  const {paymentStore,savePayments} = await import('/src/lib/payment-store.js');
  const nextNumber='26992222222222222222';
  const fields={docType:'增值税发票',type:'普通发票',buyer:'测试购买方公司',seller:'出行测试公司',date:'2026-11-18',total:50,amount:50,tax:0,number:nextNumber};
  const draft=(id,fields,text) => ({id,name:id+'.pdf',blob:new File([id],id+'.pdf'),fields,rawText:text,status:'done',pages:[],renderedPages:[],include:false});
  const trip=draft('earlier-trip',{docType:'行程单',seller:fields.seller,date:fields.date,total:50},'行程单');
  s.invoices.push(trip);
  await a.recognizeAll();
  const pending=s.supplements.find(record=>record.name==='earlier-trip.pdf');
  const pendingBefore=!!pending && !pending.ledgerKey;
  const invoice=draft('later-invoice',fields,'发票');
  s.invoices.push(invoice);
  const staged=a.matchingDraftNumber(pending);
  await a.saveRecognizedInvoices([invoice]);
  savePayments([...paymentStore.rows,{id:'existing-sheet-row',date:'2026-11-18',seller:'独立缴费测试公司',total:77,reimbursement:'未核对'}]);
  const payment=(id,seller,total) => draft(id,{docType:'付款凭证',seller,date:fields.date,total},
    ['账单','支付成功','商户全称：'+seller,'付款金额：'+total+'.00','2026-11-18'].join('\n'));
  s.invoices.push(payment('invoice-bill',fields.seller,50),payment('sheet-bill','独立缴费测试公司',77));
  await a.recognizeAll();
  await a.recognizeAll();
  const bill=s.invoices.find(i=>i.id==='sheet-bill'), saved=paymentStore.rows.find(r=>r.id==='existing-sheet-row');
  return {pendingBefore,staged,trip:s.invoices.find(i=>i.id==='earlier-trip').linkedLedgerKey,
    invoiceBill:s.invoices.find(i=>i.id==='invoice-bill').linkedLedgerKey,
    paymentBill:bill.paymentId, confirmed:saved.evidenceConfirmed,rows:paymentStore.rows.length,attachments:s.ledger[nextNumber].supplementHashes.length};
});
assert.deepEqual(linked,{pendingBefore:true,staged:'26992222222222222222',trip:'26992222222222222222',invoiceBill:'26992222222222222222',paymentBill:'existing-sheet-row',confirmed:false,rows:1,attachments:2});
assert.deepEqual(errors,[]);console.log('BROWSER PASS: assignment preview/apply without financial changes, explicit save, no-cost automatic supplements, amount filter, direct attachment preview, searchable/collapsible projects; no page errors');
} finally { await browser.close(); }

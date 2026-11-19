import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { exportPaymentList } from '../src/lib/payment-list-export.js';
import { readPaymentBatch } from '../src/lib/payment-records.js';

const dir=await mkdtemp(path.join(os.tmpdir(),'payment-export-'));
try {
  const record={id:'p1',date:'2026-03-02',seller:'示例商户',project:'东区',total:35,reimbursement:'已报销',
    lines:[{purpose:'材料',lineAmount:30},{purpose:'运费',lineAmount:5}]};
  const cash={id:'p2',date:record.date,seller:'现金收款方',recordType:'现金无凭证',total:10};
  const attachments=['付款凭证','订单详情'].map((kind,i)=>({kind,name:i?'订单.pdf':'付款.png',blob:new Blob(['content'+i])}));
  const result=await exportPaymentList([record,cash],async r=>r.id===record.id?attachments:[],async(parts,name,blob)=>{
    const subdir=path.join(dir,...parts);
    await mkdir(subdir,{recursive:true});
    // Simulate the desktop writer returning a collision-renamed path.
    const saved=parts.length?'副本 '+name:name;
    await writeFile(path.join(subdir,saved),new Uint8Array(await blob.arrayBuffer()));
    return [...parts,saved].join('\\');
  });
  assert.equal(result.fileCount,2);
  const rows=readPaymentBatch(await readFile(path.join(dir,result.filename)),result.filename).records;
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0].lines.map(l=>l.lineAmount),[30,5]);
  assert.equal(rows[0].total,35);
  assert.equal(rows[0].originalStatus,'已报销');
  assert.equal(rows[0].project,'东区');
  assert.equal(rows[0].attachmentRefs.length,2);
  for(const [i,ref] of rows[0].attachmentRefs.entries())assert.equal(await readFile(path.join(dir,ref),'utf8'),'content'+i);
  assert.equal(rows[1].recordType,'现金无凭证');
  assert.deepEqual(rows[1].attachmentRefs,[]);
  console.log('整理清单的分组金额、报销状态与两份附件的相对链接回读通过');
} finally {await rm(dir,{recursive:true,force:true});}

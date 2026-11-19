<script setup>
import ImportFileDialog from '../components/ImportFileDialog.vue';
import ExpenseAssignmentImport from '../components/ExpenseAssignmentImport.vue';
import DocumentImage from "../components/DocumentImage.vue";
import PaymentImportReview from '../components/PaymentImportReview.vue';
import { reconcileEvidenceTransactions, paymentRange } from '../lib/payment-transactions.js';
import { recognizePaymentEvidenceFile } from '../lib/payment-evidence-import.js';
import { paymentEvidenceCandidates } from '../lib/payment-reconciliation.js';
import { activePaymentAttachments, paymentAttachmentItems, linkPaymentFile, suggestedEvidenceKind } from '../lib/payment-attachments.js';
import { exportPaymentList } from '../lib/payment-list-export.js';
import { exportPaymentEvidenceCopies, pickPaymentExportWriter } from '../lib/payment-evidence-export.js';
import { fileHash, isPdf } from "../lib/file-utils.js";
import { formatMoney as money } from "../lib/format.js";
import ExpenseAllocationSelect from '../components/ExpenseAllocationSelect.vue';
import SupplierMatch from '../components/SupplierMatch.vue';
import InvoiceSupplementLink from '../components/InvoiceSupplementLink.vue';
import { renderPdfPages } from '../lib/pdftext.js';
import { receiptType } from '../lib/invoice-intake.js';
import SearchSelect from "../components/SearchSelect.vue";
import { useExpenseOptions } from "../composables/useExpenseOptions";
const expenseChoices = useExpenseOptions();
import AppIcon from "../components/AppIcon.vue";
import { paymentColumns, numericColumns } from "../lib/expense-columns";
import { computed, ref, shallowRef, onBeforeUnmount } from 'vue';
import { paymentStore, savePayments, pendingPaymentCount as missing, needsPaymentEvidence } from '../lib/payment-store';
import { allocationKind,allocationIssue } from '../lib/payment-records';
import { getLedgerAttachment } from '../lib/ledger-attachments';
import { directory,suggestAllocation } from '../lib/expense-directory';
const query=ref(''), saving=ref(false), attaching=ref(false), selectedIds=ref([]), selectedStatus=ref('未核对');
const failedCopies=shallowRef([]), inspectCandidate=shallowRef(null);
const exporting=ref(false);
async function exportSelected(){
 if(exporting.value||saving.value||attaching.value)return;
 const ids=new Set(selectedIds.value),records=paymentStore.rows.filter(r=>ids.has(r.id));
 if(!records.length)return;
 exporting.value=true;
 try{
  const write=await pickPaymentExportWriter();if(!write)return;
  const result=await exportPaymentList(records,async record=>{
   const items=paymentAttachmentItems(record,await getLedgerAttachment('payment:'+record.id));
   if(record.duplicateAttachmentHashes?.length)for(const item of items)item.hash ||= await fileHash(item.blob);
   if((record.evidenceHash||record.evidenceOriginalHash)&&!items.length)throw Error(record.source+' 的已存原件无法读取');
   return activePaymentAttachments(record,items);
  },write);
  message.value='已导出 '+result.filename+'，共 '+records.length+' 笔付款、'+result.fileCount+' 份附件';
 }catch(error){message.value='导出未完成：'+error.message+'。已写出的附件副本保留在所选目录。';}
 finally{exporting.value=false;}
}
function setBatchStatus(){
 const ids=new Set(selectedIds.value);
 const change=paymentStore.rows.filter(r=>ids.has(r.id) && !r.linkedLedgerKey && !r.supplementOnly && !r.duplicateOf);
 savePayments(paymentStore.rows.map(r=>change.includes(r)?{...r,reimbursement:selectedStatus.value}:r));
 message.value='已将 '+change.length+' 笔付款设为'+selectedStatus.value;selectedIds.value=[];
}
const evidenceFile=ref(null), previewPages=ref([]), attachmentItems=ref([]), attachmentKind=ref(''); let previewGeneration=0;
const message=ref(''),onlyMissing=ref(false),editing=ref(null),preview=ref(''),candidates=ref([]),period=ref('');
const rows=computed(()=>paymentStore.rows.filter(r=>(!onlyMissing.value||needsPaymentEvidence(r))&&(!query.value||[r.seller,r.payer,r.project,r.purpose,r.buyer].join(' ').includes(query.value))));
const tableRows=computed(()=>rows.value.flatMap(r=>(r.lines?.length?r.lines:[{}]).map((line,i)=>({...r,...line,total:i===0?r.total:'',refund:i===0?r.refund:'',record:r,rowKey:r.id+'|'+i}))));
const fields=[['date','下单日期'],['recordType','记录类型'],['dateRange','日期范围'],['payer','付款名称'],['seller','收款名称'],['total','实付合计'],['refund','退回金额'],['buyer','归属公司'],['project','使用项目'],['team','使用班组/单位'],['deliveryNumber','送货单编号'],['expenseOwner','费用归属人'],['assignmentNote','归属备注'],['note','备注'],['tags','标签'],['reimbursementPeriod','报销期间']];
const activeAttachments=computed(()=>activePaymentAttachments(editing.value,attachmentItems.value));
async function toggleDuplicate(item){
 const record=editing.value;
 if(!record || attaching.value)return;
 const hash=item.hash || await fileHash(item.blob);
 if(record!==editing.value)return;
 item.hash=hash;
 const ignored=new Set(record.duplicateAttachmentHashes||[]);
 if(ignored.has(hash)) ignored.delete(hash);
 else if(activeAttachments.value.length>1) ignored.add(hash);
 else {message.value='请保留至少一份有效原件';return;}
 record.evidenceOriginalHash ||= attachmentItems.value[0]?.hash || await fileHash(attachmentItems.value[0].blob);
 record.duplicateAttachmentHashes=[...ignored];
 const payment=activeAttachments.value.find(i=>i.kind==='付款凭证');
 record.evidenceHash=payment?(payment.hash||await fileHash(payment.blob)):'';
 record.evidenceConfirmed=false;message.value='保存核对结果后生效，重复副本仍可查看或恢复。';
}
const stageCheck=computed(()=>{
 const record=editing.value;
 if(record?.recordType!=='阶段汇总') return null;
 const transactions=activeAttachments.value.filter(i=>i.kind==='付款凭证').flatMap(item=>{
  const omit=record.evidenceSelection?.find(s=>s.hash===item.hash)?.omit || [];
  const tx=item.transactions?.length?item.transactions:[{fields:item.fields||{}}];
  return tx.filter((_,i)=>!omit.includes(i));
 });
 return reconcileEvidenceTransactions(transactions,record.total,record.dateRange);
});
function close(){inspectCandidate.value=null;attachmentKind.value='';previewGeneration++;editing.value=null;candidates.value=[];attachmentItems.value=[];evidenceFile.value=null;if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';for(const url of previewPages.value)URL.revokeObjectURL(url);previewPages.value=[];}
onBeforeUnmount(close);
async function showEvidence(file) {
 const generation=++previewGeneration; evidenceFile.value=file;
 if(preview.value)URL.revokeObjectURL(preview.value);preview.value='';for(const url of previewPages.value)URL.revokeObjectURL(url);previewPages.value=[];
 if(isPdf(file)){
  const pages=await renderPdfPages(file,{maxPages:20,scale:2});
  if(generation!==previewGeneration){pages.forEach(url=>URL.revokeObjectURL(url));return;}previewPages.value=pages;
 }else preview.value=URL.createObjectURL(file);
}
async function loadAttachments(id) {
 const f=await getLedgerAttachment('payment:'+id);
 const items=paymentAttachmentItems(editing.value,f);
 if(editing.value?.duplicateAttachmentHashes?.length) for(const item of items) item.hash ||= await fileHash(item.blob);
 if(editing.value?.id===id)attachmentItems.value=items;return items;
}
async function open(r){close();message.value='';editing.value={...r,lines:(r.lines||[]).map(l=>({...l})),allocation:allocationKind(r)};const generation=previewGeneration;try{const items=await loadAttachments(r.id);if(generation!==previewGeneration)return;if(items[0])await showEvidence(items[0].blob);}catch(e){message.value=e.message;}}
function linkedTrip(key){editing.value.linkedLedgerKey=key;editing.value.evidenceConfirmed=false;}
const importedImages=shallowRef([]);
function patchPayment(id, changes){
 savePayments(paymentStore.rows.map(r=>r.id===id?{...r,...changes}:r));
}
async function copySelected(jobs) {
 const failures=[];
 for(const job of jobs){
  const {id,candidate,kind}=job;
  try {
   const record=paymentStore.rows.find(r=>r.id===id);
   if(!record) throw new Error('未找到对应付款');
   const changes=await linkPaymentFile(record,candidate,kind);
   const latest=paymentStore.rows.find(r=>r.id===id);
   patchPayment(id,{...changes,pendingCopies:(latest.pendingCopies||[]).filter(p=>p.hash!==candidate.hash)});
  } catch(e){failures.push({...job,reason:e.message});}
 }
 failedCopies.value=[...failedCopies.value,...failures];
 return failures.length;
}
async function retryCopies(){
 if(saving.value)return;
 saving.value=true;
 try {const jobs=failedCopies.value;failedCopies.value=[];
  const failed=await copySelected(jobs);message.value=failed?failed+' 份附件仍待补存':'附件已补存';}
 finally{saving.value=false;}
}
async function importReviewed(entries){
 if(saving.value)return;
 saving.value=true;
 try {
  const next=new Map(paymentStore.rows.map(r=>[r.id,r]));
  const additions=[], jobs=[];
  for(const {record,attachments,existing} of entries){
   const prior=next.get(record.id);
   if(Boolean(prior)!==existing||prior?.linkedLedgerKey||prior?.duplicateOf||prior?.supplementOnly)throw Error('付款记录有变动，请重新核对');
   const plan=attachments.map(({candidate,kind,omit})=>({hash:candidate.hash,name:candidate.file.name,kind,omit}));
   const merge=items=>[...new Map([...(items||[]),...plan].map(p=>[p.hash,p])).values()];
   const row=prior||record;
   next.set(record.id,plan.length?{...row,evidenceSelection:merge(row.evidenceSelection),pendingCopies:merge(row.pendingCopies)}:row);
   if(!prior)additions.push(record);
   jobs.push(...attachments.map(a=>({...a,id:record.id})));
  }
  savePayments([...next.values()]);
  const failed=await copySelected(jobs);
  message.value='新增 '+additions.length+' 笔，补充已有付款 '+(entries.length-additions.length)+' 笔，已关联 '+(jobs.length-failed)+' 份附件。'+(failed?'另有 '+failed+' 份复制失败，可重试。':'');
 } catch(e){message.value=e.message;}
 finally{saving.value=false;}
}
function findImages(){
 const matches=paymentEvidenceCandidates(editing.value,importedImages.value).map(c=>c.file);
 candidates.value=[...matches,...importedImages.value.filter(c=>!matches.includes(c))];
 message.value='匹配到 '+matches.length+' 份候选，按匹配程度列出；可查看原件后添加。';
}
async function inspectUpload(file){
 if(!file || !editing.value)return;
 const id=editing.value.id;attaching.value=true;message.value='正在读取附件内容';
 try {
  let c;
  try {c=await recognizePaymentEvidenceFile(file);}
  catch(e){c={file,fields:{},warnings:[e.message]};}
  if(id!==editing.value?.id)return;
  await inspect(c);
  message.value=c.warnings?.join('；') || '请查看原件和附件性质后确认添加';
 }finally{attaching.value=false;}
}
async function inspect(c){
 inspectCandidate.value=c;attachmentKind.value=suggestedEvidenceKind(c);await showEvidence(c.file);
}
async function attach(input){
 const candidate=input?.file?input:{file:input}, file=candidate.file, record=editing.value;
 if(!file || !record || attaching.value || saving.value)return;
 if(!attachmentKind.value){message.value='请先选择附件性质';return;}
 if(record.linkedLedgerKey){message.value='此项已关联主发票';return;}
 const kind=attachmentKind.value,id=record.id;
 attaching.value=true;
 try {
  const changes=await linkPaymentFile(record,candidate,kind);
  const hash=candidate.hash||await fileHash(file);
  const latest=paymentStore.rows.find(r=>r.id===id);
  if(!latest)throw new Error('付款记录已变化，请重新打开');
  changes.pendingCopies=(latest.pendingCopies||[]).filter(p=>p.hash!==hash);
  patchPayment(id,changes);
  if(editing.value?.id!==id)return;
  Object.assign(editing.value,changes);
  await loadAttachments(id);await showEvidence(file);attachmentKind.value='';inspectCandidate.value=null;
  message.value='已关联软件内副本，相同文件只保留一份。';
 }catch(e){message.value='附件未完成保存，可重试：'+e.message;}
 finally{attaching.value=false;}
}
function save(){const d=editing.value;if(d.recordType==='合计'){message.value='统计行请在导入预览中排除';return;}if(d.linkedLedgerKey){d.evidenceConfirmed=false;if(d.reimbursement==='已报销'){message.value='已关联主发票的行程单不能单独报销';return;}}d.purpose=(d.lines||[]).map(l=>l.purpose).filter(Boolean).join(' / ')||d.purpose;if((!d.date&&d.recordType!=='阶段汇总')||(!d.seller&&d.recordType!=='阶段汇总')||d.total===''||!Number.isFinite(Number(d.total))){message.value='请补全日期、收款方和有效金额';return;}try{savePayments(paymentStore.rows.map(r=>r.id===d.id?{...d}:r));close();message.value='已保存核对结果';}catch(e){message.value=e.message;}}
async function exportAttachments(){
 try {
  const saved=paymentStore.rows.find(row=>row.id===editing.value?.id);
  if(!saved)throw new Error('付款记录不存在');
  const result=await exportPaymentEvidenceCopies(saved,activePaymentAttachments(saved,attachmentItems.value));
  if(result.canceled)return;
  message.value='已导出 '+result.paths.length+' 份副本到付款凭证整理 / '+result.folder+'；软件内附件和用户原始文件不变。';
 } catch(e){message.value='导出未完成：'+e.message+'。已导出的副本会保留，原文件不受影响。';}
}
function suggest(){const r=suggestAllocation(editing.value.seller,editing.value.buyer);if(r){editing.value.buyer=r.buyer;editing.value.project=r.project;editing.value.allocation='指定工地';editing.value.evidenceConfirmed=false;}else message.value='未配置唯一对应关系，请手动选择公司与工地';}
</script><template>
<section class="expense-screen">
<header class="expense-heading"><div><h1>付款凭证</h1></div><div class="heading-counts"><span class="soft-badge">{{ paymentStore.rows.length }} 笔付款</span><span class="status-pill warning" v-if="missing">{{ missing }} 笔待补凭证</span></div></header>
<section class="finance-card">
  <PaymentImportReview :existing-rows="paymentStore.rows" :period="period" :saving="saving" @commit="importReviewed" @evidence="importedImages=$event" @error="message=$event"><div class="payment-period"><label>报销期间<input v-model="period" placeholder="如：2026年第三季度"></label><ExpenseAssignmentImport /></div></PaymentImportReview>
  <button v-if="failedCopies.length" class="btn" :disabled="saving" @click="retryCopies">重试 {{ failedCopies.length }} 份附件</button><p v-if="failedCopies.length">{{ failedCopies[0].reason }}</p><p v-if="message && !editing" role="status" class="finance-notice">{{ message }}</p>
  <div class="payment-filters"><div class="filter-group"><input v-model="query" type="search" placeholder="搜索收款方、项目或费用" aria-label="搜索付款记录" /><label class="inline-check"><input v-model="onlyMissing" type="checkbox" />仅看待补凭证 <span class="count-dot">{{ missing }}</span></label></div><div class="filter-group"><label class="inline-check"><input type="checkbox" :disabled="!rows.length" :checked="rows.length>0 && rows.every(r=>selectedIds.includes(r.id))" @change="selectedIds=$event.target.checked?rows.map(r=>r.id):[]" />全选筛选结果</label><select v-model="selectedStatus" aria-label="批量报销状态"><option>未核对</option><option>未报销</option><option>已报销</option></select><button class="btn" :disabled="saving || !selectedIds.length" @click="setBatchStatus">设置所选 {{ selectedIds.length }} 笔状态</button><button class="btn" :disabled="exporting||saving||attaching||!selectedIds.length" @click="exportSelected">{{ exporting?'正在导出…':'导出清单与附件' }}</button><span class="table-count">{{ rows.length }} 笔 · {{ tableRows.length }} 行明细</span></div></div>
  <div v-if="tableRows.length" class="finance-table-wrap payment-list"><table class="finance-table"><thead><tr><th class="sticky-action">操作</th><th v-for="[key,label] in paymentColumns" :key="key" :class="{'number-cell':numericColumns.includes(key)}">{{ label }}</th><th>票据类型 / 标签</th><th>凭证</th><th>报销状态</th></tr></thead><tbody><tr v-for="r in tableRows" :key="r.rowKey"><td class="sticky-action"><input v-if="r.rowKey===r.id+'|0'" type="checkbox" v-model="selectedIds" :value="r.id" aria-label="选择此笔付款" /><button class="text-action" :disabled="saving || attaching" @click="open(r.record)"><AppIcon name="edit" :size="14" />核对 / 编辑</button></td><td v-for="[key] in paymentColumns" :key="key" :class="{'number-cell':numericColumns.includes(key)}">{{ numericColumns.includes(key)?money(r[key]):r[key]||'—' }}</td><td><span v-if="r.sourceKind==='receipt'" class="status-pill neutral">{{ r.receiptType || '其他票据' }}</span><small>{{ r.tags }}</small></td><td><span class="status-pill" :class="r.evidenceConfirmed?'success':'warning'">{{ (r.recordType==='现金无凭证'||r.cashWithoutEvidence)?'现金无凭证':r.linkedLedgerKey?'主发票附件（不计费）':r.duplicateOf?'重复记录':r.evidenceConfirmed?'已核对':r.evidenceHash?'待核对':'缺少凭证' }}</span></td><td><span class="status-pill" :class="r.reimbursement==='已报销'?'success':'neutral'">{{ r.reimbursement }}</span></td></tr></tbody></table></div>
  <div v-else class="finance-empty"><AppIcon name="payment" :size="34" /><strong>{{ paymentStore.rows.length?'没有匹配的付款':'暂无付款记录' }}</strong><span>{{ paymentStore.rows.length?'调整搜索或筛选条件':'导入付款清单，开始核对凭证' }}</span></div>
</section>
<div v-if="editing" class="payment-overlay" role="dialog" aria-modal="true" aria-labelledby="payment-dialog-title" @keydown.esc="close"><section class="payment-dialog"><header class="finance-dialog-heading"><div><h2 id="payment-dialog-title">付款核对</h2><span>{{ editing.date }} · {{ editing.seller }}</span></div><button class="icon-button" aria-label="关闭付款核对" @click="close"><AppIcon name="close" /></button></header><div class="payment-columns"><section class="payment-evidence"><div class="evidence-toolbar"><h3>凭证原件</h3><label>附件性质<select v-model="attachmentKind" :disabled="inspectCandidate?.fields?.kind==='order'"><option value="">请选择性质</option><option>付款凭证</option><option>订单详情</option><option>其他附件</option></select></label><ImportFileDialog v-if="!editing.linkedLedgerKey" label="添加附件" accept="image/*,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff" :disabled="attaching || saving" @files="inspectUpload($event[0])" /><button v-if="!editing.linkedLedgerKey" class="btn" @click="findImages">匹配截图</button></div><p class="field-hint">添加时保存软件内副本，不修改原文件。订单详情不会自动作为付款凭证。导出命名使用已保存的付款信息。</p><button v-if="attachmentItems.length" type="button" class="btn" @click="exportAttachments">整理并导出附件副本</button><div v-if="attachmentItems.length" class="evidence-candidates"><div v-for="(item,index) in attachmentItems" :key="index"><button type="button" class="btn" @click="inspectCandidate=null;showEvidence(item.blob)">{{ item.kind }}：{{ item.name }}</button> <button v-if="attachmentItems.length>1" type="button" class="text-action" @click="toggleDuplicate(item)">{{ editing.duplicateAttachmentHashes?.includes(item.hash)?'已标重复 · 恢复有效':'标为重复副本' }}</button></div></div><button v-if="inspectCandidate" type="button" class="btn" :disabled="attaching || saving" @click="attach(inspectCandidate)">确认添加这份附件</button><div class="evidence-canvas"><template v-if="preview || previewPages.length"><img v-if="preview" :src="preview" alt="凭证原件" /><DocumentImage v-for="(url,index) in previewPages" :key="index" :file="evidenceFile" :src="url" :page-number="index + 1" :alt="'凭证第 '+(index+1)+' 页'" /></template><div v-else class="finance-empty"><AppIcon name="payment" :size="38" /><strong>尚未关联截图</strong><span>{{ editing.recordType==='现金无凭证' || editing.cashWithoutEvidence ? '本笔已标记现金无凭证' : '可添加凭证后核对' }}</span></div></div><div v-if="candidates.length" class="evidence-candidates"><button v-for="(f,index) in candidates" :key="index" class="btn" @click="inspect(f)">{{ f.file?.name || f.name }}{{ f.fields?.kind==='order'?'（识别为订单）':f.fields?.kind==='payment'?'（识别为付款）':'' }}</button></div></section><section class="payment-form"><h3>付款信息</h3><p v-if="stageCheck" class="field-hint">{{ paymentRange(editing.dateRange).label }} · 已核实 {{ stageCheck.unique.length }} 笔，共 {{ money(stageCheck.total) }} 元 · 重叠 {{ stageCheck.duplicates.length }} 条 · 待核 {{ stageCheck.unresolved.length }} 条 · {{ stageCheck.matches?'金额相符':'尚未核平' }}</p><p v-if="editing.pendingCopies?.length" class="field-hint">待补存附件：{{ editing.pendingCopies.map(p=>p.name).join('、') }}。可重新选择原件补存。</p><p v-if="editing.sourceKind==='receipt'" class="field-hint">其他票据 · {{ editing.receiptType }}<br />原票购买方：{{ editing.receiptFields?.buyer || '未填写' }}</p><p v-if="editing.linkedLedgerKey" class="field-hint">已关联主发票 {{ editing.linkedLedgerKey }}，不单独计入费用。</p><InvoiceSupplementLink v-else-if="receiptType(editing.receiptFields)==='行程单'" :file="evidenceFile" :fields="editing.receiptFields" :payment-id="editing.id" @linked="linkedTrip" /><div class="form-grid"><label v-for="[k,label] in fields" :key="k">{{ label }}<SearchSelect v-if="expenseChoices[k]" v-model="editing[k]" :options="expenseChoices[k]" :label="label" @update:model-value="editing.evidenceConfirmed=false;if(k==='project'&&editing.project)editing.allocation='指定工地'" /><input v-else v-model="editing[k]" :type="k==='date'?'date':'text'" :list="k==='buyer'?'payment-buyers':k==='project'?'payment-projects':undefined" @input="editing.evidenceConfirmed=false" /><SupplierMatch v-if="k==='seller'" v-model="editing.seller" /></label></div><label class="inline-check"><input type="checkbox" v-model="editing.cashWithoutEvidence" />现金支付且无凭证（可与阶段汇总同时使用）</label><datalist id="payment-buyers"><option v-for="b in directory.buyers" :key="b">{{ b }}</option></datalist><datalist id="payment-projects"><option v-for="p in directory.projects" :key="p">{{ p }}</option></datalist><div class="form-grid"><label>费用归属<ExpenseAllocationSelect v-model="editing.allocation" v-model:project="editing.project" v-model:buyer="editing.buyer" @change="editing.evidenceConfirmed=false" /></label><label>报销状态<select v-model="editing.reimbursement"><option>未核对</option><option>未报销</option><option>已报销</option></select></label></div><button class="text-action" @click="suggest"><AppIcon name="link" :size="15" />使用厂家对应关系</button><p v-if="allocationIssue(editing)" class="field-hint">{{ editing.allocation==='待确认'?'费用归属待确认':allocationIssue(editing) }}</p><h3>材料 / 费用明细</h3><div class="line-edit-list"><div v-for="(line,i) in editing.lines" :key="i" class="line-edit-item"><label class="line-title">材料或费用名称<input v-model="line.purpose" @input="editing.evidenceConfirmed=false" /></label><div class="form-grid"><label v-for="[key,label] in [['unit','单位'],['quantity','数量'],['unitPrice','单价'],['lineAmount','金额（元）']]" :key="key">{{ label }}<input v-model="line[key]" @input="editing.evidenceConfirmed=false" /></label></div></div></div><label class="inline-check review-confirm"><input v-model="editing.evidenceConfirmed" type="checkbox" :disabled="!editing.evidenceHash || !!editing.linkedLedgerKey || !activeAttachments.some(item => item.kind === '付款凭证')" />已核对凭证的日期、金额和收款方</label><p v-if="message" role="alert" class="finance-notice">{{ message }}</p></section></div><footer class="finance-dialog-footer"><span :class="editing.evidenceConfirmed?'status-pill success':'status-pill warning'">{{ editing.recordType==='现金无凭证'||editing.cashWithoutEvidence?'现金无凭证':editing.evidenceConfirmed?'凭证已确认':'凭证待补全 / 核对' }}</span><button class="btn" @click="close">取消</button><button class="btn-primary" :disabled="attaching || saving" @click="save"><AppIcon name="check" :size="16" />保存核对结果</button></footer></section></div>
</section></template>

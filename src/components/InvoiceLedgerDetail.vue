<script setup>
import SearchSelect from "./SearchSelect.vue";
import SearchTags from "./SearchTags.vue";
import { useExpenseOptions } from "../composables/useExpenseOptions";
const expenseChoices = useExpenseOptions();
import InvoiceTypeTags from "./InvoiceTypeTags.vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { invoiceActions } from "../invoiceStore";
import { deductionStatus, missingReimbursementFields, redInvoiceStatus } from "../lib/invoice-ledger";
import { getLedgerAttachment, saveLedgerAttachment } from "../lib/ledger-attachments";
import { renderPdfPages } from "../lib/pdftext";

import InvoiceReviewEditor from "./InvoiceReviewEditor.vue";
import { invoiceProblems } from "../lib/invoice-review";
const editing = ref(false);
const props = defineProps({ entry: { type: Object, required: true }, version: { type: Number, default: 0 }, editInitially: Boolean });
const emit = defineEmits(["close", "attachment-change"]);
watch(() => props.entry.key, () => { editing.value = props.editInitially; }, { immediate: true });
const fileInput = ref(null);
const attachment = ref(null);
const attachmentBundle = ref(null), selectedAttachment = ref('');
const images = ref([]);
const message = ref("");
const formMessage = ref("");
const zoom = ref(100);
let generation = 0;
const isPdf = computed(() => /\.pdf$/i.test(attachment.value?.name || "") || attachment.value?.blob?.type === "application/pdf");
const missing = computed(() => missingReimbursementFields(props.entry));
const money = value => value === "" || value == null ? "—" : Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const detailTotals = computed(() => {
  const lines = props.entry.details || [];
  const sum = key => {
    if (!lines.length || lines.some(line => line[key] === "" || line[key] == null || !Number.isFinite(Number(line[key])))) return "";
    return Math.round(lines.reduce((sum, line) => sum + Number(line[key]), 0) * 100) / 100;
  };
  const total = props.entry.total === "" || props.entry.total == null ? sum("total") : props.entry.total;
  return { amount: sum("amount"), tax: sum("tax"), total };
});
function clearImages() { for (const url of images.value) if (url?.startsWith("blob:")) URL.revokeObjectURL(url); images.value = []; }
async function loadAttachment() {
  const current = ++generation;
  clearImages(); attachment.value = null; message.value = "";
  try {
    const found = await getLedgerAttachment(props.entry.key);
    if (current !== generation) return;
    attachmentBundle.value = found || null;
    const source = selectedAttachment.value ? found?.supplements?.find(item=>item.hash===selectedAttachment.value) : found?.blob ? found : null;
    attachment.value = source || null;
    if (!source?.blob) return;
    message.value = "正在生成预览…";
    const result = /\.pdf$/i.test(source.name) || source.blob.type === "application/pdf"
      ? (await renderPdfPages(source.blob, { maxPages: 20, scale: 2 })).filter(Boolean)
      : [URL.createObjectURL(source.blob)];
    if (current !== generation) { result.forEach(url => URL.revokeObjectURL(url)); return; }
    images.value = result;
    message.value = result.length ? "" : "无法生成预览，请检查原件。";
  } catch (err) { if (current === generation) message.value = `原件读取失败：${err.message || err}`; }
}
watch(() => props.entry.key, () => { selectedAttachment.value=''; attachmentBundle.value=null; });
watch([() => props.entry.key, () => props.version, selectedAttachment], loadAttachment, { immediate: true });
watch(() => props.entry.key, () => { formMessage.value = ""; zoom.value = 100; });
onBeforeUnmount(() => { generation++; clearImages(); });
async function attach(event) {
  const file = event.target.files?.[0]; event.target.value = "";
  if (!file) return;
  const key = props.entry.key;
  try { await saveLedgerAttachment(key, file); emit("attachment-change"); }
  catch (err) { message.value = `保存失败：${err.message || err}`; }
}
function updateValue(key, value) {
  try { const r=invoiceActions.updateReconciliation(props.entry.key,{[key]:value});formMessage.value=r.ok?"":r.message; } catch(error) { formMessage.value="保存失败："+error.message; }
}
function update(key, event) {
  try {
    const result = invoiceActions.updateReconciliation(props.entry.key, { [key]: event.target.value });
    if (!result.ok) { event.target.value = props.entry[key] || (key === "reimbursement" ? "未核对" : ""); formMessage.value = result.message; }
    else formMessage.value = "";
  } catch (err) { formMessage.value = `保存失败：${err.message || err}`; }
}
</script>

<template>
  <section class="detail-pane" aria-label="发票对照详情">
    <header class="detail-heading"><div><div class="detail-eyebrow">发票对照</div><strong>{{ entry.number || '无号码' }}</strong></div><button class="btn" aria-label="关闭详情" @click="emit('close')">关闭</button></header>
    <div class="comparison-body">
      <section class="preview-pane" aria-label="发票原件预览">
        <div class="preview-toolbar"><div class="preview-title"><strong>发票原件</strong><span>{{ attachment?.name || '尚未关联原件' }}</span></div><div class="preview-actions"><button class="btn" :disabled="zoom <= 75" aria-label="缩小发票" @click="zoom = Math.max(75, zoom - 25)">−</button><span>{{ zoom }}%</span><button class="btn" :disabled="zoom >= 200" aria-label="放大发票" @click="zoom = Math.min(200, zoom + 25)">＋</button><button class="btn" @click="fileInput?.click()">{{ attachment ? '更换原件' : '关联原件' }}</button><input ref="fileInput" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp" class="hidden" @change="attach" /></div></div>
        <div v-if="attachmentBundle?.supplements?.length" class="attachment-selector"><label>查看原件 / 附件 <select v-model="selectedAttachment" class="field-input"><option value="">发票原件{{ attachmentBundle.blob ? '' : '（尚未关联）' }}</option><option v-for="file in attachmentBundle.supplements" :key="file.hash" :value="file.hash">行程单 · {{ file.name }}</option></select></label><small>行程单仅作附件，不重复计费。</small></div>
        <div class="preview-scroll" tabindex="0" aria-label="发票原件，可滚动查看">
          <div v-if="!attachment && !message" class="preview-empty"><strong>还没有关联发票原件</strong><p>识别发票后可自动匹配，也可以手动选择 PDF 或图片。</p><button class="btn" @click="fileInput?.click()">关联发票原件</button></div>
          <p v-if="message" class="preview-note" role="status">{{ message }}</p>
          <div v-for="(url, index) in images" :key="url" class="preview-page" :style="{ width: `${zoom}%` }"><img :src="url" :alt="`发票原件第 ${index + 1} 页`" /></div>
          <p v-if="isPdf && images.length === 20" class="preview-note">预览最多显示前 20 页。</p>
        </div>

      </section>
      <aside class="detail-scroll" aria-label="票面和报销信息" tabindex="0">
        <div class="detail-status"><span :class="{ deducted: deductionStatus(entry) === '已抵税' }">抵税：{{ deductionStatus(entry) }}</span><span>报销：{{ entry.reimbursement || '未核对' }}</span><span v-if="redInvoiceStatus(entry)" class="red-tag">{{ redInvoiceStatus(entry) }}</span></div>

        <p v-if="invoiceProblems(entry).length" class="form-notice">待复核：{{ invoiceProblems(entry).join("、") }}</p><button class="btn-primary" @click="editing = true">编辑 / 复核发票</button><InvoiceReviewEditor v-if="editing" :entry="entry" @close="editing=false" /><p v-if="entry.reviewedAt">已人工复核</p><p v-if="entry.reimbursementPeriod">报销期间：{{ entry.reimbursementPeriod }}（具体日期以原记录为准）</p><h3>票面信息</h3>
        <dl class="detail-grid">
          <div><dt>开票日期</dt><dd>{{ entry.date || '—' }}</dd></div><div><dt>票种</dt><dd><InvoiceTypeTags :entry="entry" /></dd></div>
          <div class="wide"><dt>销售方</dt><dd>{{ entry.seller || '—' }}</dd></div><div class="wide"><dt>购买方</dt><dd>{{ entry.buyer || '—' }}</dd></div>
          <div><dt>金额</dt><dd>{{ money(entry.amount) }}</dd></div><div><dt>税额</dt><dd>{{ money(entry.tax) }}</dd></div>
          <div><dt>价税合计</dt><dd>{{ money(entry.total) }}</dd></div><div><dt>有效抵扣税额</dt><dd>{{ money(entry.validTax) }}</dd></div>
          <div><dt>票种标签</dt><dd>{{ entry.typeLabel || '—' }}</dd></div><div><dt>勾选时间</dt><dd>{{ entry.selectionTime || '—' }}</dd></div>
          <div><dt>官方勾选状态</dt><dd>{{ entry.officialSelection || '—' }}</dd></div><div><dt>发票状态</dt><dd>{{ entry.invoiceStatus || '—' }}</dd></div>
          <div><dt>红字蓝字 / 正数</dt><dd>{{ entry.redBlue || '—' }}</dd></div>
        </dl>
        <template v-if="entry.details?.length">
          <h3>发票明细 · {{ entry.details.length }} 行</h3>
          <div class="detail-lines"><table><thead><tr><th>项目</th><th>数量 / 单位</th><th>税率</th><th>金额</th><th>税额</th></tr></thead><tbody><tr v-for="(line, index) in entry.details" :key="index"><td>{{ line.service || '—' }}<small v-if="line.specification">{{ line.specification }}</small></td><td>{{ line.quantity || '—' }} {{ line.unit }}</td><td>{{ line.rate || '—' }}</td><td>{{ money(line.amount) }}</td><td>{{ money(line.tax) }}</td></tr></tbody><tfoot><tr><th colspan="3">明细合计</th><td>{{ money(detailTotals.amount) }}</td><td>{{ money(detailTotals.tax) }}</td></tr></tfoot></table></div>
          <div class="detail-total">价税合计 <strong>{{ money(detailTotals.total) }}</strong></div>
        </template>
        <h3>个人报销</h3>

        <label>付款账户 / 付款人<input class="field-input" :value="entry.payer || ''" placeholder="付款账户或付款人" @change="update('payer', $event)" /></label>
        <label>报销日期<input class="field-input" type="date" :value="entry.reimbursementDate || ''" @change="update('reimbursementDate', $event)" /></label>
        <p v-if="entry.reimbursement === '已报销' && missing.length" class="form-notice">这条已有报销记录还缺少：{{ missing.join('、') }}，请补充。</p>
        <p v-if="formMessage" class="form-notice" role="status">{{ formMessage }}</p>
        <div class="detail-fields"><label>报销人<SearchSelect :model-value="entry.reimburser || ''" :options="expenseChoices.reimburser" label="报销人"  @update:model-value="updateValue('reimburser', $event)" /></label><label>工地<SearchSelect :model-value="entry.project || ''" :options="expenseChoices.project" label="工地"  @update:model-value="updateValue('project', $event)" /></label><label class="wide">用途<SearchSelect :model-value="entry.purpose || ''" :options="expenseChoices.purpose" label="用途" allow-custom @update:model-value="updateValue('purpose', $event)" /></label><label>报销状态<select class="field-input" :value="entry.reimbursement || '未核对'" @change="update('reimbursement', $event)"><option>未核对</option><option>已报销</option><option>未报销</option></select></label><label>付款方式<SearchSelect :model-value="entry.payment || ''" :options="expenseChoices.payment" label="付款方式"  @update:model-value="updateValue('payment', $event)" /></label><label class="wide">自定义标签<SearchTags :model-value="entry.tags || ''" :options="expenseChoices.tags" @update:model-value="updateValue('tags', $event)" /></label></div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.detail-pane{width:100%;height:100%;display:flex;flex-direction:column;min-height:0;background:#fff}.detail-heading{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid #dfe5ed}.detail-heading strong{font-size:14px;overflow-wrap:anywhere}.detail-heading .btn{flex:none}.detail-eyebrow{font-size:11px;color:#64748b;margin-bottom:3px}.comparison-body{display:flex;flex:1;min-height:0;min-width:0}.preview-pane{flex:1;min-width:0;display:flex;flex-direction:column;background:#f1f4f8}.preview-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#fff;border-bottom:1px solid #e3e9f0}.preview-title{display:flex;flex-direction:column;min-width:0;gap:2px}.preview-title strong{font-size:13px}.preview-title span{font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-actions{display:flex;align-items:center;gap:5px;flex:none;font-size:12px}.preview-scroll{flex:1;min-height:0;overflow:auto;padding:20px}.preview-page{margin:0 auto 16px;min-width:75%;background:white;border:1px solid #dce3eb;box-shadow:0 2px 10px rgba(15,23,42,.08)}.preview-page img{display:block;width:100%;height:auto}.preview-empty{display:grid;justify-items:center;align-content:center;min-height:250px;color:#475569;text-align:center}.preview-empty p,.preview-note,.preview-foot,.section-note{font-size:12px;color:#64748b;line-height:1.6}.preview-foot{flex:none;padding:7px 16px;background:#fff;border-top:1px solid #e3e9f0}.detail-scroll{flex:none;width:min(520px,42%);min-width:0;overflow:auto;padding:20px 22px;border-left:1px solid #e3e9f0}.detail-scroll h3{font-size:14px;margin:22px 0 10px}.detail-status{display:flex;gap:6px;flex-wrap:wrap;font-size:11px}.detail-status span{padding:4px 7px;background:#f1f5f9;border-radius:4px;color:#475569}.detail-status .deducted{background:#edf9f1;color:#166534}.detail-status .red-tag{background:#fef2f2;color:#b91c1c}.detail-grid,.detail-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0;font-size:12px}.detail-grid .wide,.detail-fields .wide{grid-column:span 2}.detail-grid>div,.detail-fields label{min-width:0}.detail-grid dt,.detail-fields label{color:#64748b}.detail-grid dd{margin:4px 0 0;color:#172033;overflow-wrap:anywhere}.detail-fields label{display:grid;gap:5px}.detail-fields input,.detail-fields select{width:100%;min-width:0}.detail-lines{overflow-x:auto}.detail-lines table{border-collapse:collapse;width:max-content;min-width:100%;font-size:11px}.detail-lines th,.detail-lines td{text-align:left;padding:8px;border-bottom:1px solid #edf1f5;vertical-align:top;white-space:nowrap}.detail-lines td:first-child{white-space:normal;min-width:140px;max-width:220px;overflow-wrap:anywhere}.detail-lines small{display:block;color:#64748b}.detail-total{text-align:right;padding:10px 8px;font-size:12px}.detail-total strong{margin-left:8px}.form-notice{padding:8px;background:#fffbeb;color:#92400e;font-size:12px;border-radius:5px}.section-note{margin:8px 0}.preview-actions .btn{padding:5px 8px}
@media(max-width:900px){.detail-scroll{width:44%}.preview-toolbar{align-items:flex-start;flex-wrap:wrap}.preview-actions{flex-wrap:wrap}}
.attachment-selector{padding:8px 16px;background:#fff;border-bottom:1px solid #dfe5ed;font-size:12px}.attachment-selector label{display:flex;align-items:center;gap:8px}.attachment-selector select{flex:1;min-width:0;font-size:12px}.attachment-selector small{display:block;margin-top:4px;color:#64748b}
</style>

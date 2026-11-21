<script setup>
import ImportFileDialog from './ImportFileDialog.vue';
import { formatMoney as money } from "../lib/format.js";
import DocumentImage from './DocumentImage.vue';
import InvoiceProjectAllocationDialog from './InvoiceProjectAllocationDialog.vue';
import { isMultiProject, projectNames, projectExpenseRows, projectAllocationState } from '../lib/invoice-allocation.js';
import SearchSelect from "./SearchSelect.vue";
import SearchTags from "./SearchTags.vue";
import { useExpenseOptions } from "../composables/useExpenseOptions";
const expenseChoices = useExpenseOptions();
import InvoiceTypeTags from "./InvoiceTypeTags.vue";
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from 'reka-ui';
import { createPreviewPan } from '../lib/preview-pan.js';
import { invoiceActions } from "../invoiceStore.js";
import { deductionStatus, missingReimbursementFields, redInvoiceStatus } from "../lib/invoice-ledger";
import { getLedgerAttachment, saveLedgerAttachment } from "../lib/ledger-attachments";
import { renderPdfPages, rotateImageUrl } from "../lib/pdftext";

import InvoiceReviewEditor from "./InvoiceReviewEditor.vue";
import { invoiceProblems } from "../lib/invoice-review";
const editing = ref(false);
const allocationOpen = ref(false);
const props = defineProps({ entry: { type: Object, required: true }, version: { type: Number, default: 0 }, editInitially: Boolean, initialSupplement:{type:String,default:''} });
const emit = defineEmits(["close", "attachment-change"]);
watch(() => props.entry.key, () => { editing.value = props.editInitially; }, { immediate: true });

const attachment = ref(null);
const attachmentBundle = ref(null), selectedAttachment = ref(props.initialSupplement);
const attachmentTab = ref(props.initialSupplement ? 'supplements' : 'original');
const isTrip = item => /行程单/.test([item.type, item.name].filter(Boolean).join(' '));
const trips = computed(() => (attachmentBundle.value?.supplements || []).filter(isTrip));
const others = computed(() => (attachmentBundle.value?.supplements || []).filter(item => !isTrip(item)));
const rotation = ref(0);
const preview = ref(null), panning = ref(false);
const pan = createPreviewPan(() => preview.value, value => { panning.value = value; });
function changeZoom(delta) { zoom.value = Math.max(75, Math.min(400, zoom.value + delta)); }
function onWheel(event) {
  if (!(event.ctrlKey || event.metaKey) || !images.value.length) return;
  event.preventDefault();
  changeZoom(event.deltaY < 0 ? 25 : -25);
}
watch(attachmentTab, value => {
  const files = value === 'original' ? [] : value === 'supplements' ? trips.value : others.value;
  if (!files.some(file => file.hash === selectedAttachment.value)) selectedAttachment.value = files[0]?.hash || '';
  rotation.value = 0;
  zoom.value = 100;
  preview.value?.scrollTo(0, 0);
});
const images = ref([]);
const message = ref("");
const formMessage = ref("");
const zoom = ref(100);
const loading = ref(true);
let displayedSource = '';
let displayedSlot = '';
let generation = 0;
const isPdf = computed(() => /\.pdf$/i.test(attachment.value?.name || "") || attachment.value?.blob?.type === "application/pdf");
const missing = computed(() => missingReimbursementFields(props.entry));
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
async function imagePreviewUrl(blob, angle) {
  const original = URL.createObjectURL(blob);
  let result;
  try { result = await rotateImageUrl(original, angle); return result; }
  finally { if (result !== original) URL.revokeObjectURL(original); }
}
async function loadAttachment() {
  const current = ++generation;
  const angle = rotation.value;
  const slot = JSON.stringify([props.entry.key, attachmentTab.value, selectedAttachment.value, angle]);
  if (displayedSlot && slot !== displayedSlot) { clearImages(); attachment.value = null; displayedSource = ''; displayedSlot = ''; }
  loading.value = true; message.value = "";
  try {
    const found = await getLedgerAttachment(props.entry.key);
    if (current !== generation) return;
    attachmentBundle.value = found || null;
    if (selectedAttachment.value === 'first') {
      const initial = found?.supplements?.[0];
      if (initial) {
        attachmentTab.value = isTrip(initial) ? 'supplements' : 'others';
        selectedAttachment.value = initial.hash;
        return;
      }
    }
    if (attachmentTab.value !== 'original' && !selectedAttachment.value) {
      const first = (attachmentTab.value === 'supplements' ? trips.value : others.value)[0];
      if (first) { selectedAttachment.value = first.hash; return; }
    }
    const source = attachmentTab.value === 'original' ? (found?.blob ? found : null)
      : found?.supplements?.find(item => item.hash === selectedAttachment.value);
    if (!source?.blob) { clearImages(); attachment.value = null; displayedSource = ''; return; }
    const identity = JSON.stringify([slot, source.hash, source.savedAt, source.linkedAt, source.name, source.blob.size, source.blob.type]);
    // 台账状态刷新也会触发附件检查；原件未变时保留已经显示的图片。
    if (identity === displayedSource && images.value.length) return;
    const result = /\.pdf$/i.test(source.name) || source.blob.type === "application/pdf"
      ? await renderPdfPages(source.blob, { maxPages: 20, scale: 2, rotation: angle })
      : [await imagePreviewUrl(source.blob, angle)];
    await Promise.all(result.filter(Boolean).map(url => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = resolve; image.src = url; })));
    if (current !== generation) { result.forEach(url => URL.revokeObjectURL(url)); return; }
    clearImages();
    attachment.value = source;
    images.value = result;
    displayedSource = identity;
    displayedSlot = slot;
    message.value = result.some(Boolean) ? "" : "无法生成预览，请检查原件。";
  } catch (err) { if (current === generation) message.value = `原件读取失败：${err.message || err}`; }
  finally { if (current === generation) loading.value = false; }
}
watch(() => props.entry.key, () => { selectedAttachment.value=props.initialSupplement; attachmentBundle.value=null; });
watch([() => props.entry.key, () => props.version, attachmentTab, selectedAttachment, rotation], loadAttachment, { immediate: true });
watch(() => props.entry.key, () => { formMessage.value = ""; zoom.value = 100; });
onBeforeUnmount(() => { generation++; pan.cancel(); clearImages(); });
async function attach([file]) {
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
    <header class="detail-heading">
      <strong class="ui-money">发票 {{ entry.number || '无号码' }}</strong>
      <slot name="navigation" />
      <div class="ml-auto flex flex-wrap gap-2">
        <button v-if="!editing" type="button" class="ui-btn-primary" @click="editing = true">进入编辑</button>
        <button v-else type="button" class="ui-btn" @click="editing = false">返回查看</button>
        <button type="button" class="ui-btn" aria-label="关闭详情" @click="emit('close')">关闭</button>
      </div>
    </header>
    <div class="comparison-body">
      <section class="preview-pane" aria-label="发票原件预览">
        <div class="border-b border-line bg-panel px-3 py-2">
          <TabsRoot v-model="attachmentTab">
            <TabsList class="flex flex-wrap gap-1" aria-label="选择原件类型">
              <TabsTrigger value="original" class="ui-btn-sm data-[state=active]:bg-brand-soft data-[state=active]:text-brand-deep">主发票原件</TabsTrigger>
              <TabsTrigger value="supplements" class="ui-btn-sm data-[state=active]:bg-brand-soft data-[state=active]:text-brand-deep">行程单附件 ({{ trips.length }})</TabsTrigger>
              <TabsTrigger v-if="others.length" value="others" class="ui-btn-sm data-[state=active]:bg-brand-soft data-[state=active]:text-brand-deep">其他附件 ({{ others.length }})</TabsTrigger>
            </TabsList>
            <TabsContent value="original" />
            <TabsContent value="supplements">
              <select v-if="trips.length" v-model="selectedAttachment" class="ui-input mt-2" aria-label="选择行程单附件">
                <option v-for="file in trips" :key="file.hash" :value="file.hash">{{ file.name }}</option>
              </select>
              <p v-else class="mt-2 text-xs text-ink-soft">暂无行程单附件。</p>
            </TabsContent>
            <TabsContent v-if="others.length" value="others">
              <select v-model="selectedAttachment" class="ui-input mt-2" aria-label="选择其他附件">
                <option v-for="file in others" :key="file.hash" :value="file.hash">{{ file.type }} · {{ file.name }}</option>
              </select>
            </TabsContent>
          </TabsRoot>
        </div>
        <div class="preview-toolbar">
          <span class="min-w-0 truncate text-xs text-ink-secondary" :title="attachment?.name">{{ attachment?.name || (attachmentTab === 'original' ? '尚未关联原件' : '未选择附件') }}</span>
          <div class="preview-actions">
            <button class="ui-btn-sm" :disabled="zoom <= 75" aria-label="缩小发票" @click="changeZoom(-25)">−</button>
            <button class="ui-btn-sm ui-money" aria-label="重置发票缩放" @click="zoom=100; preview?.scrollTo(0,0)">{{ zoom }}%</button>
            <button class="ui-btn-sm" :disabled="zoom >= 400" aria-label="放大发票" @click="changeZoom(25)">＋</button>
            <button class="ui-btn-sm" :disabled="!attachment" aria-label="旋转发票 90 度" @click="rotation = (rotation + 90) % 360">旋转</button>
            <ImportFileDialog v-if="attachmentTab === 'original'" compact :label="attachmentBundle?.blob ? '更换原件' : '关联原件'" accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp" @files="attach" />
          </div>
        </div>
        <div ref="preview" class="preview-scroll" :class="{ 'can-pan': images.length, panning }"
          :aria-busy="loading" tabindex="0" aria-label="票面预览，拖动平移，Ctrl 加滚轮缩放"
          @pointerdown="images.length && pan.down($event)" @pointermove="pan.move" @pointerup="pan.up" @pointercancel="pan.up" @lostpointercapture="pan.up" @wheel="onWheel">
          <div v-if="!loading && !attachment && !message && attachmentTab === 'original'" class="preview-empty"><strong>还没有关联发票原件</strong><p>识别发票后可自动匹配，也可手动关联 PDF 或图片。</p></div>
          <p v-if="loading || message" class="preview-loading" role="status">{{ message || '正在加载预览…' }}</p>
          <div v-for="(url, index) in images" :key="index" class="preview-page" :style="{ width: `${zoom}%` }">
            <DocumentImage :file="attachment?.blob" :name="attachment?.name" :src="url" :page-number="index + 1" :rotation="rotation" :alt="`发票原件第 ${index + 1} 页`" draggable="false" />
          </div>
          <p v-if="isPdf && images.length === 20" class="preview-note">预览最多显示前 20 页。</p>
        </div>

      </section>
      <aside class="detail-scroll" aria-label="票面和报销信息" tabindex="0">
        <div class="detail-status"><span :class="{ deducted: deductionStatus(entry) === '已抵税' }">抵税：{{ deductionStatus(entry) }}</span><span>报销：{{ entry.reimbursement || '未核对' }}</span><span v-if="redInvoiceStatus(entry)" class="red-tag">{{ redInvoiceStatus(entry) }}</span></div>

        <p v-if="invoiceProblems(entry).length" class="form-notice">待复核：{{ invoiceProblems(entry).join("、") }}</p><InvoiceReviewEditor v-if="editing" :entry="entry" @close="editing=false" /><p v-if="entry.reviewedAt">已人工复核</p><p v-if="entry.reimbursementPeriod">报销期间：{{ entry.reimbursementPeriod }}（具体日期以原记录为准）</p><h3>票面信息</h3>
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
        <h3>工地归属 <button class="btn" @click="allocationOpen=true">工地分配</button></h3>
        <template v-if="isMultiProject(entry)"><p class="section-note">{{ projectAllocationState(entry).label }} · {{ projectNames(entry) || '尚未指定工地' }}</p><div class="allocation-detail-row" v-for="(row,index) in projectExpenseRows(entry)" :key="index"><span>{{ row.project }}<small v-if="row.remark">{{ row.remark }}</small></span><b>¥{{ money(row.total) }}</b></div></template>
        <p v-else class="section-note">{{ entry.project || entry.allocation || '待确认' }}</p>
        <InvoiceProjectAllocationDialog v-if="allocationOpen" :entry="entry" @close="allocationOpen=false" />
        <p v-if="entry.expenseOwner" class="section-note">费用归属人：{{ entry.expenseOwner }}</p><p v-if="entry.assignmentNote" class="section-note">归属备注：{{ entry.assignmentNote }}</p>        <h3>个人报销</h3>
        <dl v-if="!editing" class="detail-grid">
          <div><dt>报销日期</dt><dd>{{ entry.reimbursementDate || '—' }}</dd></div>
          <div><dt>报销人</dt><dd>{{ entry.reimburser || '—' }}</dd></div>
          <div><dt>付款账户 / 付款人</dt><dd>{{ entry.payer || '—' }}</dd></div>
          <div><dt>付款方式</dt><dd>{{ entry.payment || '—' }}</dd></div>
          <div><dt>用途</dt><dd>{{ entry.purpose || '—' }}</dd></div>
          <div><dt>自定义标签</dt><dd>{{ entry.tags || '—' }}</dd></div>
        </dl>
        <template v-else>

        <label>付款账户 / 付款人<input class="field-input" :value="entry.payer || ''" placeholder="付款账户或付款人" @change="update('payer', $event)" /></label>
        <label>报销日期<input class="field-input" type="date" :value="entry.reimbursementDate || ''" @change="update('reimbursementDate', $event)" /></label>
        <p v-if="entry.reimbursement === '已报销' && missing.length" class="form-notice">这条已有报销记录还缺少：{{ missing.join('、') }}，请补充。</p>
        <p v-if="formMessage" class="form-notice" role="status">{{ formMessage }}</p>
        <div class="detail-fields"><label>报销人<SearchSelect :model-value="entry.reimburser || ''" :options="expenseChoices.reimburser" label="报销人"  @update:model-value="updateValue('reimburser', $event)" /></label><label v-if="!isMultiProject(entry)">工地<SearchSelect :model-value="entry.project || ''" :options="expenseChoices.project" label="工地"  @update:model-value="updateValue('project', $event)" /></label><label class="wide">用途<SearchSelect :model-value="entry.purpose || ''" :options="expenseChoices.purpose" label="用途" allow-custom @update:model-value="updateValue('purpose', $event)" /></label><label>报销状态<select class="field-input" :value="entry.reimbursement || '未核对'" @change="update('reimbursement', $event)"><option>未核对</option><option>已报销</option><option>未报销</option></select></label><label>付款方式<SearchSelect :model-value="entry.payment || ''" :options="expenseChoices.payment" label="付款方式"  @update:model-value="updateValue('payment', $event)" /></label><label class="wide">自定义标签<SearchTags :model-value="entry.tags || ''" :options="expenseChoices.tags" @update:model-value="updateValue('tags', $event)" /></label></div>
        </template>
        <h3>打印与批次记录</h3>
        <dl class="detail-grid">
          <div><dt>打印状态</dt><dd>{{ entry.printed ? '已打印' : '未打印' }}</dd></div>
          <div><dt>打印日期</dt><dd>{{ entry.printedAt || '—' }}</dd></div>
          <div v-if="entry.batches?.length" class="wide"><dt>批次</dt><dd v-for="(batch, index) in entry.batches" :key="index">{{ batch.name || batch.id || '批次' }} {{ batch.date || '' }}</dd></div>
        </dl>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.allocation-detail-row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #edf1f5;font-size:12px}.allocation-detail-row small{display:block;margin-top:3px;color:#64748b}.allocation-detail-row b{white-space:nowrap;font-variant-numeric:tabular-nums}
.detail-pane{width:100%;height:100%;display:flex;flex-direction:column;min-height:0;background:#fff}.detail-heading{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid #dfe5ed}.detail-heading strong{font-size:14px;overflow-wrap:anywhere}.detail-heading .btn{flex:none}.detail-eyebrow{font-size:11px;color:#64748b;margin-bottom:3px}.comparison-body{display:flex;flex:1;min-height:0;min-width:0}.preview-pane{flex:1;min-width:0;display:flex;flex-direction:column;background:#f1f4f8}.preview-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:#fff;border-bottom:1px solid #e3e9f0}.preview-title{display:flex;flex-direction:column;min-width:0;gap:2px}.preview-title strong{font-size:13px}.preview-title span{font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.preview-actions{display:flex;align-items:center;gap:5px;flex:none;font-size:12px}.preview-scroll{position:relative;scrollbar-gutter:stable;flex:1;min-height:0;overflow:auto;padding:20px}.preview-page{margin:0 auto 16px;min-width:75%;background:white;border:1px solid #dce3eb;box-shadow:0 2px 10px rgba(15,23,42,.08)}.preview-page img{display:block;width:100%;height:auto}.preview-empty{display:grid;justify-items:center;align-content:center;min-height:250px;color:#475569;text-align:center}.preview-empty p,.preview-note,.preview-foot,.section-note{font-size:12px;color:#64748b;line-height:1.6}.preview-foot{flex:none;padding:7px 16px;background:#fff;border-top:1px solid #e3e9f0}.detail-scroll{scrollbar-gutter:stable;flex:none;width:45%;min-width:0;overflow:auto;padding:20px 22px;border-left:1px solid #e3e9f0}.detail-scroll h3{font-size:14px;margin:22px 0 10px}.detail-status{display:flex;gap:6px;flex-wrap:wrap;font-size:11px}.detail-status span{padding:4px 7px;background:#f1f5f9;border-radius:4px;color:#475569}.detail-status .deducted{background:#edf9f1;color:#166534}.detail-status .red-tag{background:#fef2f2;color:#b91c1c}.detail-grid,.detail-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0;font-size:12px}.detail-grid .wide,.detail-fields .wide{grid-column:span 2}.detail-grid>div,.detail-fields label{min-width:0}.detail-grid dt,.detail-fields label{color:#64748b}.detail-grid dd{margin:4px 0 0;color:#172033;overflow-wrap:anywhere}.detail-fields label{display:grid;gap:5px}.detail-fields input,.detail-fields select{width:100%;min-width:0}.detail-lines{overflow-x:auto}.detail-lines table{border-collapse:collapse;width:max-content;min-width:100%;font-size:11px}.detail-lines th,.detail-lines td{text-align:left;padding:8px;border-bottom:1px solid #edf1f5;vertical-align:top;white-space:nowrap}.detail-lines td:first-child{white-space:normal;min-width:140px;max-width:220px;overflow-wrap:anywhere}.detail-lines small{display:block;color:#64748b}.detail-total{text-align:right;padding:10px 8px;font-size:12px}.detail-total strong{margin-left:8px}.form-notice{padding:8px;background:#fffbeb;color:#92400e;font-size:12px;border-radius:5px}.section-note{margin:8px 0}.preview-actions .btn{padding:5px 8px}
@media(max-width:900px){.detail-scroll{width:45%}.preview-toolbar{align-items:flex-start;flex-wrap:wrap}.preview-actions{flex-wrap:wrap}}
.preview-loading{position:sticky;top:0;z-index:2;margin:0;height:0;overflow:visible;font-size:12px;color:#475569;pointer-events:none}
.detail-heading { flex-wrap:wrap; padding:8px 12px; }
.preview-toolbar { padding:6px 10px; }
.preview-scroll.can-pan { cursor:grab; touch-action:none; }
.preview-scroll.panning { cursor:grabbing; user-select:none; }
.detail-scroll { padding:14px; }
@media(max-width:680px) {
  .comparison-body { display:grid; grid-template-rows:minmax(170px,45%) minmax(0,1fr); }
  .preview-pane { min-height:0; }
  .detail-scroll { width:auto; border-left:none; border-top:1px solid #e3e6ea; }
}
</style>

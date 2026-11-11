<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from "reka-ui";
import { invoiceStore, invoiceActions, sortedInvoices, buyerOptions, docTypeOptions, selectInvoice } from "../invoiceStore";
import InvoiceBuyerCheck from '../components/InvoiceBuyerCheck.vue';
import { useBuyerCheck } from '../composables/useBuyerCheck.js';
import { matchesBuyerCheck, buyerCheckLabels } from '../lib/invoice-buyer-check.js';
import InvoiceUpload from "../components/InvoiceUpload.vue";
import InvoicePreview from "../components/InvoicePreview.vue";
import InvoiceRow from "../components/InvoiceRow.vue";
import InvoiceList from "../components/InvoiceList.vue";
import InvoiceDocumentPreview from "../components/InvoiceDocumentPreview.vue";
import InvoicePrintPanel from "../components/InvoicePrintPanel.vue";
import InvoiceReimbursementToolbar from "../components/InvoiceReimbursementToolbar.vue";
import { inferExpenseTag } from "../lib/invoice-tags";
import { toast, toastInfo } from "../lib/toast";
import { filesFromDrop, dragHasSupported } from "../lib/upload";

const search = ref("");
const startDate = ref("");
const endDate = ref("");
const upload = ref(null);
const dragging = ref(false);
const dragRejected = ref(false);
const printPreviewOpen = ref(false);
const reimbursementFilter = ref("all");
const expenseTagFilter = ref("all");
const reimbursementSelection = ref([]);
const buyerCheckFilter = ref('all');
const { checker: buyerChecker, configured: buyersConfigured, counts: buyerCounts } = useBuyerCheck(() => invoiceStore.invoices.map(inv => inv.fields));
function scanBuyers() {
  search.value = ''; startDate.value = ''; endDate.value = '';
  reimbursementFilter.value = 'all'; expenseTagFilter.value = 'all';
  invoiceStore.buyerFilter = '全部'; invoiceStore.docTypeFilter = '全部';
  buyerCheckFilter.value = 'issues';
}
const sorted = computed(() => sortedInvoices().filter(({ inv }) => {
  if (!matchesBuyerCheck(buyerChecker.value(inv.fields), buyerCheckFilter.value)) return false;
  const entry = inv.history?.entry;
  const tag = entry?.expenseTagSet ? entry.expenseTag : (entry?.expenseTag || inferExpenseTag(inv));
  const query = search.value.trim().toLowerCase();
  const matches = !query || [inv.name, inv.fields.number, inv.fields.seller, inv.fields.buyer, inv.fields.type].some(value => String(value || "").toLowerCase().includes(query));
  const date = String(inv.fields.date || "").slice(0, 10);
  const matchesDate = (!startDate.value || (date && date >= startDate.value)) && (!endDate.value || (date && date <= endDate.value));
  return matches && matchesDate && (expenseTagFilter.value === "all" || tag === expenseTagFilter.value) && (reimbursementFilter.value === "all" || (reimbursementFilter.value === "reimbursed" ? entry?.reimbursement === "已报销" : entry?.reimbursement !== "已报销"));
}));
const activeItem = computed(() => sorted.value.find(item => item.inv.id === invoiceStore.selectedId));
watch(sorted, items => {
  if (items.length && !items.some(item => item.inv.id === invoiceStore.selectedId)) selectInvoice(items[0].inv.id);
}, { immediate: true });

function hasFiles(event) { return Array.from(event.dataTransfer?.types || []).includes("Files"); }
function onDragOver(event) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragging.value = true;
  dragRejected.value = !dragHasSupported(event.dataTransfer);
  if (event.dataTransfer) event.dataTransfer.dropEffect = dragRejected.value ? "none" : "copy";
}
function onDragLeave(event) { if (!event.relatedTarget) dragging.value = false; }
async function onDrop(event) {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragging.value = false;
  const files = await filesFromDrop(event.dataTransfer);
  await upload.value?.intake(files);
}
onMounted(() => {
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
});
onBeforeUnmount(() => {
  window.removeEventListener("dragover", onDragOver);
  window.removeEventListener("dragleave", onDragLeave);
  window.removeEventListener("drop", onDrop);
});
const selectedInvoices = computed(() => invoiceStore.invoices.filter(inv => reimbursementSelection.value.includes(inv.id)));
function selectReimbursement(id, checked) {
  reimbursementSelection.value = checked ? [...new Set([...reimbursementSelection.value, id])] : reimbursementSelection.value.filter(key => key !== id);
}
function updateReimbursements(action, date = "") {
  const selected = selectedInvoices.value;
  if (!selected.length) return;
  const label = action === "mark" ? `标记为已报销，日期 ${date}` : "取消已报销标记并清除报销日期，恢复为未核对";
  if (!window.confirm(`将选中的 ${selected.length} 张发票${label}。确认继续吗？`)) return;
  try {
    const result = invoiceActions.updateCurrentReimbursements(selected, action, date);
    invoiceStore.msg = `${action === 'mark' ? '已标记' : '已取消'} ${result.changed} 张；${result.unchanged} 张状态无需更改，${result.skipped} 张号码不完整、重复或信息冲突，需核对。`;
    toastInfo(invoiceStore.msg, { duration: 8000 });
    reimbursementSelection.value = [];
  } catch (err) { toastInfo(`保存失败：${err.message || err}`); }
}
const unrecognizedCount = computed(() => invoiceStore.invoices.filter((i) => i.status !== "done").length);
const duplicateCount = computed(() => invoiceStore.invoices.filter((i) => i.duplicateReason).length);
// 历史已用/已认证（台账查重）：勾选中且历史已用的张数，可一键排除以避免重复使用
const reusedIncludedCount = computed(() => invoiceStore.invoices.filter((i) => i.include && i.history && i.history.usedBefore).length);
const buyers = computed(() => buyerOptions());
const docTypes = computed(() => docTypeOptions());

function dedupe() {
  const n = invoiceActions.removeConfirmedDuplicates();
  if (n) toast(`已移除 ${n} 张重复发票，每组保留一张。`);
  else toastInfo("未发现可自动移除的重复发票；号码不完整或票面信息不一致的请核对。");
}
function excludeReused() {
  const n = invoiceActions.excludeReused(visibleInvs.value);
  if (n) toast(`已排除 ${n} 张有历史勾选或使用记录的发票。`);
  else toastInfo("勾选中没有带历史勾选或使用记录的发票。");
}

// 打印勾选批量操作：作用于当前筛选后可见的发票
const visibleInvs = computed(() => sorted.value.map((x) => x.inv));
function selectAll() {
  invoiceActions.setIncludeAll(visibleInvs.value, true);
  const selected = visibleInvs.value.filter(inv => inv.include).length;
  const skipped = visibleInvs.value.length - selected;
  toastInfo(`已勾选 ${selected} 张${skipped ? `，${skipped} 张已报销发票未自动勾选` : ""}。`, { duration: 3000 });
}
function selectNone() {
  invoiceActions.setIncludeAll(visibleInvs.value, false);
  toastInfo("已全部取消勾选。", { duration: 2000 });
}
function invertSelect() {
  invoiceActions.invertInclude(visibleInvs.value);
  toastInfo("已反选。", { duration: 2000 });
}

</script>

<template>
  <div class="invoice-workspace">
    <div class="workspace-top"><div><h1>发票管理</h1></div><label class="invoice-search"><span aria-hidden="true">⌕</span><input v-model="search" type="search" placeholder="搜索发票号码、销售方或购买方" aria-label="搜索发票" /></label><InvoiceUpload ref="upload" /></div>
    <div v-if="dragging" class="file-drag-notice" role="status">{{ dragRejected ? '请拖入 PDF、图片或文件夹' : '松开文件，即可导入并识别' }}</div>
    <InvoiceBuyerCheck v-model="buyerCheckFilter" :configured="buyersConfigured" :counts="buyerCounts" @scan="scanBuyers" />
    <details class="work-disclosure"><summary>筛选与报销 </summary>
      <div class="filter-content">
        <label>购买方<select v-model="invoiceStore.buyerFilter" class="field-input"><option v-for="buyer in buyers" :key="buyer" :value="buyer">{{ buyer }}</option></select></label>
        <label>发票类型<select v-model="invoiceStore.docTypeFilter" class="field-input"><option v-for="type in docTypes" :key="type" :value="type">{{ type }}</option></select></label>
        <label>开票日期从<input v-model="startDate" type="date" class="field-input" :max="endDate || undefined" /></label>
        <label>至<input v-model="endDate" type="date" class="field-input" :min="startDate || undefined" /></label>
        <span class="filter-note">支持 PDF、图片和文件夹；导入后自动识别。也可将文件拖入窗口。</span>
      </div>
      <InvoiceReimbursementToolbar v-model:status="reimbursementFilter" v-model:tag="expenseTagFilter" :selected-count="selectedInvoices.length" :visible-count="sorted.length" @select-all="reimbursementSelection = sorted.map(item => item.inv.id)" @clear="reimbursementSelection = []" @mark="updateReimbursements('mark', $event)" @cancel="updateReimbursements('cancel')" />
    </details>
    <div v-if="invoiceStore.invoices.length" class="work-actions"><span><b>{{ invoiceStore.invoices.length }}</b> 张发票<span v-if="unrecognizedCount"> · {{ unrecognizedCount }} 张未识别</span><span v-if="duplicateCount"> · {{ duplicateCount }} 张重复</span><span v-if="reusedIncludedCount"> · {{ reusedIncludedCount }} 张有历史记录</span></span><button class="btn" :disabled="invoiceStore.busy || !unrecognizedCount" @click="invoiceActions.recognizeAll">{{ invoiceStore.busy ? '识别中…' : '全部识别' }}</button><button class="btn" :disabled="invoiceStore.busy || invoiceStore.invoices.length < 2" @click="dedupe">批量移除重复</button><button class="btn" :disabled="!reusedIncludedCount" @click="excludeReused">排除历史记录</button><button class="btn-ghost" @click="invoiceActions.clearAll">清空</button><span v-if="invoiceStore.msg" class="work-message" role="status">{{ invoiceStore.msg }}</span></div>
    <div v-if="invoiceStore.invoices.length" class="invoice-columns">
      <InvoiceList :items="sorted" :active-id="activeItem?.inv.id" @select-all="selectAll" @select-none="selectNone" @invert="invertSelect" />
      <div class="invoice-middle"><InvoiceDocumentPreview :invoice="activeItem?.inv" /><DialogRoot v-model:open="printPreviewOpen"><DialogTrigger as-child><button class="print-layout-trigger" type="button"><strong>打印排版预览</strong><span>查看每页打印效果 ↗</span></button></DialogTrigger><DialogPortal><DialogOverlay class="print-layout-overlay" /><DialogContent class="print-layout-modal"><header class="print-layout-header"><div><DialogTitle class="print-layout-title">打印排版预览</DialogTitle><DialogDescription class="print-layout-description">双击票面放大，可拖动、缩放和旋转；打印设置在主页面底部。</DialogDescription></div><DialogClose class="btn" aria-label="关闭打印排版预览">关闭</DialogClose></header><div class="print-layout-content"><InvoicePreview /></div></DialogContent></DialogPortal></DialogRoot></div>
      <section class="work-panel invoice-detail"><div class="panel-heading"><div><h2>发票详情 <span>（可编辑核对）</span></h2><p>选择发票后可修改识别结果</p></div></div><p v-if="activeItem && ['missing','unmatched'].includes(buyerChecker(activeItem.inv.fields))" class="finance-notice">{{ buyerCheckLabels[buyerChecker(activeItem.inv.fields)] }}，请对照原件核对。</p><InvoiceRow v-if="activeItem" :key="activeItem.inv.id" :item="activeItem" :reimbursement-selected="reimbursementSelection.includes(activeItem.inv.id)" @select-reimbursement="selectReimbursement" /><div v-else class="work-empty">请选择一张发票</div></section>
    </div>
    <div v-else class="work-empty invoice-welcome"><strong>还没有发票</strong><span>将 PDF、图片或文件夹拖入窗口，或使用上方按钮选择。</span></div>
    <InvoicePrintPanel />
  </div>
</template>

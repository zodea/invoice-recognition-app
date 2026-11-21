<script setup>
import { invoiceStore, invoiceActions, invoiceSummary, sortedInvoices, buyerOptions, docTypeOptions, selectInvoice } from "../invoiceStore.js";
import { matchesBuyerCheck } from '../lib/invoice-buyer-check.js';
import { workspaceInvoiceStatus } from '../lib/invoice-workspace-status.js';
import { matchInvoiceFiles } from '../lib/invoiceFileMatcher.js';
import { invoiceWorkbooksWithoutExportCopies } from '../lib/invoice-workbook-links.js';
import { ledgerKey } from '../lib/invoice-ledger-state.js';
import { pendingPaymentCount } from '../lib/payment-store.js';
import { inferExpenseTag } from "../lib/invoice-tags";
import { toast, toastInfo, toastUndo } from "../lib/toast";
import { filesFromDrop, dragHasSupported } from "../lib/upload";

const props=defineProps({active:{type:Boolean,default:true}});
const paymentPanel = ref(null);
const paymentDrawer = shallowRef(null);
const filterPopover = shallowRef(null);
const filtersOpen = ref(false);
async function showFilters() {
  try {
    filterPopover.value = (await import('../components/InvoiceFilterPopover.vue')).default;
    filtersOpen.value = true;
  } catch (error) { toastInfo('筛选工具加载失败：' + error.message); }
}
const invoiceWorkbooks = shallowRef([]);
const paperTotals = ref({});
function addWorkbooks(sources) {
  const updated = new Map(invoiceWorkbooks.value.map(source => [source.sourcePath, source]));
  for (const source of sources) updated.set(source.sourcePath, source);
  invoiceWorkbooks.value = invoiceWorkbooksWithoutExportCopies([...updated.values()]);
}
function adoptPaperTotal(reason) {
  const invoice = activeItem.value?.inv;
  if (!invoice || !reason) return;
  const totals = paperTotals.value;
  const previous = totals[invoice.id];
  totals[invoice.id] = { reason };
  const accepted = totals[invoice.id];
  toastUndo('已按票面价税合计核对。', () => {
    if (paperTotals.value !== totals || totals[invoice.id] !== accepted) return;
    if (previous) totals[invoice.id] = previous;
    else delete totals[invoice.id];
  });
}
function clearWorkspace() { invoiceActions.clearAll(); invoiceWorkbooks.value = []; paperTotals.value = {}; }
const fileMatches = computed(() => invoiceWorkbooks.value.length ? matchInvoiceFiles(invoiceWorkbooks.value.flatMap(source => source.records), invoiceStore.invoices) : null);
async function showPaymentDrawer(files, id) {
  try {
    if (!paymentDrawer.value) paymentDrawer.value = (await import('../components/PaymentEvidenceDrawer.vue')).default;
    await nextTick();
    return await paymentPanel.value.show(files, id);
  } catch (error) { toastInfo('付款工作台加载失败：' + error.message); }
}
function reviewPaymentFiles(files) { return showPaymentDrawer(files); }
function openPayment(id) { return showPaymentDrawer(null, id); }
const firstSupplement = computed(() => invoiceStore.supplements.find(record => !record.ledgerKey) || invoiceStore.supplements[0]);
const pendingSupplements = computed(() => invoiceStore.supplements.filter(record => !record.ledgerKey).length);
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const intakeFilter = ref('all');
const decisions = new WeakMap();
function decisionFor(inv) {
  if (!decisions.has(inv)) decisions.set(inv, computed(() => invoiceActions.intakeDecision(inv)));
  return decisions.get(inv).value;
}
const intakeCounts = computed(() => invoiceStore.invoices.reduce((counts, inv) => { const state = decisionFor(inv).state; counts[state] = (counts[state] || 0) + 1; return counts; }, {}));
const intakePending = computed(() => ['unrecognized','ready','review','receipt','supplement'].reduce((sum,key)=>sum+(intakeCounts.value[key]||0),0));
async function saveSupplements(){let saved=0;const errors=[];for(const inv of invoiceStore.invoices.filter(inv=>invoiceActions.intakeDecision(inv).state==='supplement')){try{await invoiceActions.saveSupplement({invoice:inv});saved++;}catch(error){errors.push(error.message);}}toastInfo(`已保存 ${saved} 份附件，不增加费用。${errors.join('；')}`);}
async function saveMatched() {
  try {
    const result = await invoiceActions.saveRecognizedInvoices();
    toastInfo('已保存 '+result.saved+' 张；留下 '+result.pending+' 张待处理。'+(result.failed?'保存失败 '+result.failed+' 张：'+result.errors.join('；'):''));
  } catch(error) { toastInfo('保存失败：'+error.message); }
}
const search = ref("");
const { applied: appliedQuery, flush: flushSearch } = useDebouncedFilter(search);
const startDate = ref("");
const endDate = ref("");
const upload = ref(null);
const batchProgress = computed(() => invoiceStore.recognitionProgress || upload.value?.progress);
const dragging = ref(false);
const dragRejected = ref(false);
const printPreviewOpen = ref(false);
const printDialog = ref(null);
const printView = shallowRef(null);
async function openPrintWorkspace(exportExcel = false) {
  try {
    if (!printView.value) printView.value = (await import('../components/InvoicePrintDialog.vue')).default;
    if (exportExcel) {
      await nextTick();
      await printDialog.value.exportExcel();
    } else printPreviewOpen.value = true;
  } catch (error) { toastInfo('打开打印与导出失败：' + error.message); }
}
const InvoiceRow = defineAsyncComponent(() => import('../components/InvoiceRow.vue'));
const InvoiceIntakeReview = defineAsyncComponent(() => import('../components/InvoiceIntakeReview.vue'));
const InvoiceReimbursementToolbar = defineAsyncComponent(() => import('../components/InvoiceReimbursementToolbar.vue'));
const ExpenseAssignmentImport = defineAsyncComponent(() => import('../components/ExpenseAssignmentImport.vue'));
const ConfirmAction = defineAsyncComponent(() => import('../components/ConfirmAction.vue'));
const summary = computed(() => invoiceSummary());
const listFilter = ref('all');
const laptop = window.matchMedia('(max-width: 1320px)');
const listCollapsed = ref(laptop.matches);
let listToggled = false;
function toggleList() {
  listToggled = true;
  listCollapsed.value = !listCollapsed.value;
}
function followWindow() {
  if (!listToggled) listCollapsed.value = laptop.matches;
}
const reimbursementFilter = ref("all");
const expenseTagFilter = ref("all");
const reimbursementSelection = ref([]);
const buyerCheckFilter = ref('all');
const { checker: buyerChecker, configured: buyersConfigured, counts: buyerCounts } = useBuyerCheck(() => invoiceStore.invoices.map(inv => inv.fields));
function scanBuyers() {
  listFilter.value = 'all'; intakeFilter.value = 'all'; search.value = ''; startDate.value = ''; endDate.value = '';
  reimbursementFilter.value = 'all'; expenseTagFilter.value = 'all';
  invoiceStore.buyerFilter = '全部'; invoiceStore.docTypeFilter = '全部';
  buyerCheckFilter.value = 'issues';
}
const filtered = computed(() => sortedInvoices().filter(({ inv }) => {
  const state = intakeFilter.value === 'all' ? '' : decisionFor(inv).state;
  if (intakeFilter.value === 'pending' && ['saved','payment-saved','linked','attachment-saved'].includes(state)) return false;
  if (intakeFilter.value === 'review' && state !== 'review') return false;
  if (intakeFilter.value === 'receipt' && !['receipt','supplement'].includes(state)) return false;
  if (intakeFilter.value === 'saved' && !['saved','payment-saved','linked','attachment-saved'].includes(state)) return false;
  if (buyerCheckFilter.value !== 'all' && !matchesBuyerCheck(buyerChecker.value(inv.fields), buyerCheckFilter.value)) return false;
  const entry = inv.history?.entry;
  const tag = inv.expenseTagSet ? inv.expenseTag : entry?.expenseTagSet ? entry.expenseTag : (inv.expenseTag || entry?.expenseTag || inferExpenseTag(inv));
  const query = appliedQuery.value.trim().toLowerCase();
  const matches = !query || [inv.name, inv.fields.number, inv.fields.seller, inv.fields.buyer, inv.fields.type].some(value => String(value || "").toLowerCase().includes(query));
  const date = String(inv.fields.date || "").slice(0, 10);
  const matchesDate = (!startDate.value || (date && date >= startDate.value)) && (!endDate.value || (date && date <= endDate.value));
  return matches && matchesDate && (expenseTagFilter.value === "all" || tag === expenseTagFilter.value) && (reimbursementFilter.value === "all" || (reimbursementFilter.value === "reimbursed" ? entry?.reimbursement === "已报销" : entry?.reimbursement !== "已报销"));
}));
const supplementCounts = computed(() => {
  const counts = new Map();
  for (const record of invoiceStore.supplements) if (record.ledgerKey) counts.set(record.ledgerKey, (counts.get(record.ledgerKey) || 0) + 1);
  return counts;
});
const workspaceItems = computed(() => filtered.value.map(item => {
  const count = Math.max(supplementCounts.value.get(ledgerKey(item.inv)) || 0, fileMatches.value?.supplementCounts.get(item.inv.id) || 0);
  const status = workspaceInvoiceStatus(item.inv, decisionFor(item.inv), count);
  const difference = fileMatches.value?.byInvoice.get(item.inv.id);
  const accepted = difference?.netDifference && paperTotals.value[item.inv.id]?.reason === difference.reason;
  return { ...item, status: status.tone === 'danger' || accepted ? status : difference || status };
}));
const segmentCounts = computed(() => workspaceItems.value.reduce((counts, { status }) => {
  counts[status.group] = (counts[status.group] || 0) + 1;
  return counts;
}, { all: workspaceItems.value.length }));
const sorted = computed(() => workspaceItems.value.filter(({ status }) => listFilter.value === 'all' || status.group === listFilter.value));
const activeItem = computed(() => sorted.value.find(item => item.inv.id === invoiceStore.selectedId));
watch(sorted, items => {
  if (items.length && !items.some(item => item.inv.id === invoiceStore.selectedId)) selectInvoice(items[0].inv.id);
}, { immediate: true });
function moveInvoice(direction) {
  const index = sorted.value.indexOf(activeItem.value);
  const next = sorted.value[index + direction];
  if (next) selectInvoice(next.inv.id);
}
function nextIssue() {
  const items = workspaceItems.value;
  const current = items.findIndex(item => item.inv.id === invoiceStore.selectedId);
  const next = [...items.slice(current + 1), ...items.slice(0, current + 1)].find(item => item.status.group === 'issue');
  if (!next) return;
  listFilter.value = 'issue';
  selectInvoice(next.inv.id);
}
function editFromPrint(id) {
  listFilter.value = 'all';
  intakeFilter.value = 'all';
  search.value = ''; startDate.value = ''; endDate.value = '';
  expenseTagFilter.value = 'all'; reimbursementFilter.value = 'all'; buyerCheckFilter.value = 'all';
  selectInvoice(id);
}
function onKeydown(event) {
  if (!props.active || event.defaultPrevented || event.target?.closest?.('input, textarea, select, [contenteditable], [role="dialog"], [role="alertdialog"], [role="combobox"], .workspace-popover')) return;
  if (event.altKey && event.key === 'Enter') { event.preventDefault(); nextIssue(); }
  else if (!event.altKey && !event.ctrlKey && !event.metaKey && event.target?.closest?.('.invoice-list') && ['ArrowUp','ArrowDown'].includes(event.key)) {
    event.preventDefault(); moveInvoice(event.key === 'ArrowUp' ? -1 : 1);
  }
}

function hasFiles(event) { return Array.from(event.dataTransfer?.types || []).includes("Files"); }
function onDragOver(event) {
  if (!props.active || !hasFiles(event)) return;
  if (event.target?.closest?.('[role="dialog"], .ledger-panel, .payment-records-panel')) { event.preventDefault(); dragging.value = false; return; }
  event.preventDefault();
  dragging.value = true;
  dragRejected.value = !dragHasSupported(event.dataTransfer) && !Array.from(event.dataTransfer.items || []).some(item=>/spreadsheet|excel/.test(item.type));
  if (event.dataTransfer) event.dataTransfer.dropEffect = dragRejected.value ? "none" : "copy";
}
function onDragLeave(event) { if (!event.relatedTarget) dragging.value = false; }
async function onDrop(event) {
  if (!props.active || !hasFiles(event)) return;
  if (event.target?.closest?.('[role="dialog"], .ledger-panel, .payment-records-panel')) { event.preventDefault(); dragging.value = false; return; }
  event.preventDefault();
  dragging.value = false;
  await upload.value?.intake(() => filesFromDrop(event.dataTransfer));
}
onMounted(() => {
  laptop.addEventListener("change", followWindow);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("dragenter", onDragOver);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
});
onBeforeUnmount(() => {
  laptop.removeEventListener("change", followWindow);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("dragenter", onDragOver);
  window.removeEventListener("dragover", onDragOver);
  window.removeEventListener("dragleave", onDragLeave);
  window.removeEventListener("drop", onDrop);
});
const selectedInvoices = computed(() => invoiceStore.invoices.filter(inv => reimbursementSelection.value.includes(inv.id)));
function selectReimbursement(id, checked) {
  reimbursementSelection.value = checked ? [...new Set([...reimbursementSelection.value, id])] : reimbursementSelection.value.filter(key => key !== id);
}
async function updateReimbursements(action, date = "") {
  const selected = selectedInvoices.value;
  if (!selected.length) return;
  const label = action === "mark" ? `标记为已报销，日期 ${date}` : "取消已报销标记并清除报销日期，恢复为未核对";
  if (!await requestConfirmation('确认报销操作', `将选中的 ${selected.length} 张发票${label}。`, '确认')) return;
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
  const n = invoiceActions.removeConfirmedDuplicates({ undoable: true });
  if (!n) toastInfo("未发现可自动移除的重复发票；号码不完整或票面信息不一致的请核对。");
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
  <div class="invoice-workspace workspace-v12">
    <progress v-if="batchProgress" class="batch-progress" :aria-label="batchProgress.label" :title="batchProgress.label" :max="batchProgress.total || 1" :value="batchProgress.total ? batchProgress.done : undefined" />
    <header class="ui-toolbar workspace-header" aria-label="发票工作台工具">
      <button class="ui-btn-ghost workspace-list-toggle" type="button" :aria-expanded="!listCollapsed" aria-controls="workspace-invoice-list" @click="toggleList">{{ listCollapsed ? '展开票据' : '收起票据' }}</button>
      <InvoiceUpload ref="upload" @payment-batch="reviewPaymentFiles" @invoice-workbooks="addWorkbooks" />
      <input v-model="search" @change="flushSearch" @keydown.enter="flushSearch" type="search" class="ui-input min-w-28 flex-1" placeholder="搜索票号或公司" aria-label="搜索发票" />
      <button v-if="!filterPopover" type="button" class="ui-btn" aria-haspopup="dialog" aria-expanded="false" @click="showFilters">筛选与入账</button>
      <component v-else :is="filterPopover" v-model:open="filtersOpen">
          <InvoiceBuyerCheck v-model="buyerCheckFilter" :configured="buyersConfigured" :counts="buyerCounts" @scan="scanBuyers" />
          <div class="grid grid-cols-2 gap-2 p-2">
            <label class="ui-label">购买方<select v-model="invoiceStore.buyerFilter" class="ui-input"><option v-for="buyer in buyers" :key="buyer">{{ buyer }}</option></select></label>
            <label class="ui-label">票种<select v-model="invoiceStore.docTypeFilter" class="ui-input"><option v-for="type in docTypes" :key="type">{{ type }}</option></select></label>
            <label class="ui-label">起始日期<input v-model="startDate" type="date" class="ui-input" :max="endDate || undefined" /></label>
            <label class="ui-label">结束日期<input v-model="endDate" type="date" class="ui-input" :min="startDate || undefined" /></label>
          </div>
          <InvoiceReimbursementToolbar v-model:status="reimbursementFilter" v-model:tag="expenseTagFilter" :selected-count="selectedInvoices.length" :visible-count="sorted.length" @select-all="reimbursementSelection = sorted.map(item => item.inv.id)" @clear="reimbursementSelection = []" @mark="updateReimbursements('mark', $event)" @cancel="updateReimbursements('cancel')" />
          <div class="flex flex-wrap items-end gap-2 border-t border-line p-2">
            <label class="ui-label">入账检查<select v-model="intakeFilter" class="ui-input"><option value="all">本批全部</option><option value="pending">尚未保存（{{ intakePending }}）</option><option value="review">需要核对（{{ intakeCounts.review || 0 }}）</option><option value="receipt">其他票据 / 附件</option><option value="saved">已保存 / 已关联</option></select></label>
            <button class="ui-btn-primary" :disabled="invoiceStore.busy || invoiceStore.savingIntake || !intakeCounts.ready" @click="saveMatched">保存可入账发票（{{ intakeCounts.ready || 0 }}）</button>
            <button v-if="intakeCounts.supplement" class="ui-btn" :disabled="invoiceStore.busy || invoiceStore.savingIntake" @click="saveSupplements">保存附件（{{ intakeCounts.supplement }}）</button>
          </div>
          <div class="flex flex-wrap items-center gap-2 border-t border-line p-2">
            <button class="ui-btn" :disabled="!!batchProgress || invoiceStore.busy || !unrecognizedCount" @click="invoiceActions.recognizeAll">{{ invoiceStore.busy ? '识别中…' : '全部识别' }}</button>
            <button class="ui-btn" :disabled="!!batchProgress || invoiceStore.busy || !duplicateCount" @click="dedupe">批量移除重复</button>
            <button class="ui-btn" :disabled="!reusedIncludedCount" @click="excludeReused">排除历史记录</button>
            <ExpenseAssignmentImport label="按清单分配工地" />
            <button class="ui-btn-danger" :disabled="!!batchProgress || invoiceStore.busy || (!invoiceStore.invoices.length && !invoiceWorkbooks.length)" @click="clearWorkspace">清空</button>
          </div>
          <span v-if="invoiceStore.msg" class="block px-2 text-xs text-ink-soft" role="status">{{ invoiceStore.msg }}</span>
      </component>
      <button v-if="!paymentDrawer" type="button" class="ui-btn" aria-haspopup="dialog" aria-expanded="false" @click="showPaymentDrawer()">付款清单与截图 <span class="ui-badge-brand">{{ pendingPaymentCount || 0 }}</span></button>
      <component v-else :is="paymentDrawer" ref="paymentPanel" :pending="pendingPaymentCount" />
      <button class="ui-btn" :disabled="!firstSupplement" @click="invoiceStore.matchSupplementHash = firstSupplement.hash">待匹配附件 <span class="ui-badge-brand">{{ pendingSupplements }}</span></button>
    </header>
    <div v-if="dragging" class="file-drag-notice" :class="{ rejected: dragRejected }" role="status">
      <div class="flex items-center gap-3 rounded-card bg-panel px-5 py-4 shadow-pop"><AppIcon :name="dragRejected ? 'alert' : 'upload'" :size="24" />
        {{ dragRejected ? '请拖入 PDF、图片、Excel 或文件夹' : '松开以导入文件夹或文件（自动忽略 ~$ 临时文件）' }}
      </div>
    </div>
    <div class="invoice-columns" :class="{ 'list-collapsed': listCollapsed }">
      <InvoiceList v-show="!listCollapsed" id="workspace-invoice-list" v-model:filter="listFilter" :counts="segmentCounts" :items="sorted" :active-id="activeItem?.inv.id" @select-all="selectAll" @select-none="selectNone" @invert="invertSelect" />
      <InvoiceDocumentPreview :invoice="activeItem?.inv" :status="activeItem?.status" :empty="!invoiceStore.invoices.length" @adopt-paper-total="adoptPaperTotal" />
      <section class="work-panel invoice-detail">
        <div class="ui-section-header detail-heading bg-surface">
          <h2 class="text-sm font-semibold">识别详情</h2><WorkspaceStatus :status="activeItem?.status" />
          <div class="ml-auto flex gap-1" aria-label="切换票据">
            <button class="ui-btn-sm" aria-label="上一张票据" :disabled="!activeItem || sorted[0] === activeItem" @click="moveInvoice(-1)">↑</button>
            <button class="ui-btn-sm" aria-label="下一张票据" :disabled="!activeItem || sorted.at(-1) === activeItem" @click="moveInvoice(1)">↓</button>
          </div>
        </div>
        <InvoiceIntakeReview v-if="activeItem" :key="activeItem.inv.id" :invoice="activeItem.inv" @open-payment="openPayment" @match-payment="reviewPaymentFiles" />
        <InvoiceRow v-if="activeItem" :key="activeItem.inv.id" :item="activeItem" :paper-reason="paperTotals[activeItem.inv.id]?.reason" :reimbursement-selected="reimbursementSelection.includes(activeItem.inv.id)" @select-reimbursement="selectReimbursement" />
        <div v-else class="work-empty">选择票据后可对照原件核对</div>
      </section>
    </div>
    <footer class="ui-toolbar workspace-footer">
      <span>已勾选 <strong>{{ summary.count }}</strong> 张</span><span>合计 <strong class="ui-money">¥{{ summary.total.toFixed(2) }}</strong></span>
      <button v-if="segmentCounts.issue" class="ui-badge-warn ui-focus" title="跳到下一张异常票据（Alt+Enter）" @click="nextIssue">{{ segmentCounts.issue }} 张异常</button>
      <span class="flex-1"></span>
      <button v-if="invoiceWorkbooks.length" class="ui-btn" @click="openPrintWorkspace()">核对版 Excel</button>
      <button v-else class="ui-btn" :disabled="!summary.count" @click="openPrintWorkspace(true)">导出 Excel</button>
      <button class="ui-btn-primary" :disabled="!summary.count && !invoiceWorkbooks.length" @click="openPrintWorkspace()">打印与导出</button>
    </footer>
    <component v-if="printView" :is="printView" ref="printDialog" v-model:open="printPreviewOpen" :source-workbooks="invoiceWorkbooks" :file-matches="fileMatches" @edit-invoice="editFromPrint" />
    <ConfirmAction v-if="confirmation" :request="confirmation" @answer="answerConfirmation" />
  </div>
</template>

<style scoped>
.batch-progress { appearance:none; position:absolute; inset:0 0 auto; z-index:3; width:100%; height:2px; border:0; pointer-events:none; }
.batch-progress::-webkit-progress-bar { background:#e7f1fb; }
.batch-progress::-webkit-progress-value { background:#1867c0; transition:width 160ms ease-out; }
.batch-progress:indeterminate { background:linear-gradient(90deg,transparent,#1867c0,transparent) left center / 35% 100% no-repeat #e7f1fb; animation:batch-reading 1.2s ease-in-out infinite alternate; }
.batch-progress:indeterminate::-webkit-progress-bar { background:transparent; }
@keyframes batch-reading { to { background-position:right center; } }
.workspace-v12 { position:relative; height: calc(100dvh - 24px); min-height: 0; gap: 10px; font-size: 13px; }
.workspace-header { min-height: 48px; flex: none; overflow-x: auto; }
.workspace-footer { min-height: 44px; flex: none; white-space: nowrap; overflow-x: auto; }
.workspace-v12 .invoice-columns { flex: 1; min-height: 0; grid-template-columns: 280px minmax(0, 1.35fr) 360px; gap: 10px; align-items: stretch; }
.workspace-v12 .invoice-columns.list-collapsed { grid-template-columns: minmax(0, 1.35fr) minmax(315px, 360px); }
.workspace-v12 :deep(.work-panel) { max-height: none; min-height: 0; }
.invoice-detail { grid-column: auto; container-type: inline-size; }
.detail-heading { position: sticky; top: 0; z-index: 2; }
.invoice-detail > :deep(.intake-review) { padding: 8px 12px; border-bottom: 1px solid #eef0f3; }
@media (max-width: 1360px) {
  .workspace-v12 .invoice-columns { grid-template-columns: minmax(195px, 23%) minmax(0, 1fr) minmax(290px, 34%); }
  .workspace-v12 .invoice-columns.list-collapsed { grid-template-columns: minmax(0, 1.35fr) minmax(295px, 38%); }
}
@media (max-width: 800px) {
  .workspace-v12 { height: auto; }
  .workspace-v12 .invoice-columns, .workspace-v12 .invoice-columns.list-collapsed { grid-template-columns: minmax(0, 1fr); }
  .workspace-v12 :deep(.invoice-list) { max-height: 44vh; }
  .workspace-v12 :deep(.invoice-document) { min-height: 440px; }
}
</style>

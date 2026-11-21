<script setup>
import { useDebouncedFilter } from '../composables/useDebouncedFilter.js';
import { formatMoney as money } from "../lib/format.js";
import {matchesInvoiceAmount} from '../lib/invoice-amount-filter.js';
import {listLedgerAttachmentMetadata} from '../lib/ledger-attachments.js';
import { directory, resolveArchiveName } from '../lib/expense-directory.js';
import { allocationKind } from '../lib/payment-allocation.js';
import { projectNames, isMultiProject, projectAllocationState, projectExpenseRows } from '../lib/invoice-allocation.js';
import { useConfirmation } from '../composables/useConfirmation.js';
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
import { readTrashCleanupQueue } from '../lib/ledger-trash-purge.js';
import { useBuyerCheck } from '../composables/useBuyerCheck.js';
import { buyerCheckLabels, matchesBuyerCheck, normalizeBuyerName } from '../lib/invoice-buyer-check.js';
import { deductionDisplay } from "../lib/invoice-status-display";
import { invoiceExpenseColumns } from "../lib/expense-columns";
import { invoiceProblems } from "../lib/invoice-review";
import { computed, onMounted, ref, watch } from "vue";
import { invoiceActions, invoiceStore } from "../invoiceStore.js";
import { deductionStatus, redInvoiceStatus } from "../lib/invoice-ledger-state.js";
import { planLedgerMatches } from "../lib/ledger-matching";

const props = defineProps({ initialBuyerCheck: { type: String, default: 'all' } });

const defaultFilters = {
  preset: 'all', query: '', project: '', buyer: '', startDate: '', endDate: '',
  selection: 'all', reimbursement: 'all', red: 'all', attachment: 'all',
  amountQuery: '', amountField: 'total', supplementOnly: false, min: '', max: '', buyerCheck: 'all',
};
const filters = ref({ ...defaultFilters, preset: props.initialBuyerCheck === 'issues' ? 'buyer' : 'all' });
const { applied: queryFilter, flush: flushQueryFilter } = useDebouncedFilter(() => filters.value.query);
const { applied: minFilter, flush: flushMinFilter } = useDebouncedFilter(() => filters.value.min);
const { applied: maxFilter, flush: flushMaxFilter } = useDebouncedFilter(() => filters.value.max);
const { applied: amountFilter, flush: flushAmountFilter } = useDebouncedFilter(() => filters.value.amountQuery);
function flushFilters() {
  flushQueryFilter();
  flushMinFilter();
  flushMaxFilter();
  flushAmountFilter();
}
const filtersPending = computed(() => filters.value.query !== queryFilter.value || filters.value.min !== minFilter.value
  || filters.value.max !== maxFilter.value || filters.value.amountQuery !== amountFilter.value);
const hasFilters = computed(() => Object.keys(defaultFilters).some(key => filters.value[key] !== defaultFilters[key]));
const { checker: buyerChecker, configured: buyersConfigured, counts: buyerCounts } = useBuyerCheck(() => entries.value);
function scanBuyers() { filters.value = { ...defaultFilters, preset: 'buyer' }; }
watch(() => props.initialBuyerCheck, value => { if (value === 'issues') scanBuyers(); });
const checkedKeys = ref([]);
const trashOpen = ref(false);
const trashNotice = ref('');
const pendingCleanup = ref(0);
function refreshCleanupQueue() {
 try { pendingCleanup.value = readTrashCleanupQueue().length; }
 catch (error) { trashNotice.value = error.message; }
}
function openTrash() { trashNotice.value = ''; refreshCleanupQueue(); trashOpen.value = true; }
async function purgeEntries(ids) {
 try {
  const result = await invoiceActions.purgeLedgerTrash(ids);
  trashNotice.value = result.warning || (result.changed ? '已永久删除 '+result.changed+' 张记录，并清理无引用的原件副本。' : '原件副本清理完成。');
 } catch(error) { trashNotice.value = '清理未完成：'+error.message; }
 finally { refreshCleanupQueue(); }
}
const editInitially = ref(false);
const projectRows = entry => isMultiProject(entry) ? projectExpenseRows(entry) : allocationKind(entry) === '指定工地' ? projectExpenseRows(entry) : [];
const projectOptions = computed(() => [...new Set([...directory.projects, ...entries.value.flatMap(entry => projectRows(entry).map(row => resolveArchiveName('projects', row.project)))].filter(Boolean))]);
const filteredProjectTotal = computed(() => filtered.value.reduce((sum, entry) => sum + projectRows(entry).filter(row => resolveArchiveName('projects', row.project) === filters.value.project).reduce((subtotal,row) => subtotal + Math.round(row.total * 100),0),0) / 100);
const supplementCounts = ref({}), tripCounts = ref({}), initialSupplement = ref('');
const reviewKeys = ref([]), reviewingSelection = ref(false), batch = ref(null);
const attachmentsReady = ref(false);
const printEntries = ref([]);
const checkedEntries = computed(() => {
  const keys = new Set(checkedKeys.value);
  return filtered.value.filter(entry => keys.has(entry.key));
});
const reviewIndex = computed(() => reviewKeys.value.indexOf(selectedKey.value));
const checkedTotal = computed(() => checkedEntries.value.reduce((sum, entry) => sum + Math.round((Number(entry.total) || 0) * 100), 0) / 100);
function openDetail(entry, attachment = '', edit = false, fromSelection = false) {
  reviewingSelection.value = fromSelection;
  reviewKeys.value = (fromSelection ? checkedEntries.value : filtered.value).map(item => item.key);
  editInitially.value = edit;
  initialSupplement.value = attachment;
  selectedKey.value = entry.key;
}
function moveDetail(offset) {
  initialSupplement.value = '';
  selectedKey.value = reviewKeys.value[reviewIndex.value + offset];
}
function reviewSelection() {
  if (checkedEntries.value.length) openDetail(checkedEntries.value[0], '', false, true);
}
function openBatch(action) { batch.value = { action, entries: checkedEntries.value.slice() }; }
const sortKey = ref("date");
const sortDir = ref("desc");
const page = ref(1);
const pageSize = ref(20);
const selectedKey = ref("");
const attachmentKeys = ref(new Set());
const attachmentVersion = ref(0);
const notice = ref("");
const syncing = ref(false);
const entries = computed(() => Object.values(invoiceStore.ledger || {}));
const selected = computed(() => invoiceStore.ledger[selectedKey.value] || null);
const matchPlan = computed(() => planLedgerMatches(invoiceStore.ledger, invoiceStore.invoices));
const eligibleCount = computed(() => matchPlan.value.matches.filter(({ key }) => !attachmentKeys.value.has(key)).length);
const presets = [
  { key: 'all', label: '全部', test: () => true },
  { key: 'unreimbursed', label: '未报销', test: entry => entry.reimbursement !== '已报销' },
  { key: 'deduction', label: '待抵扣', test: entry => deductionStatus(entry) === '未勾选' && !redInvoiceStatus(entry) },
  { key: 'trip', label: '含行程单', test: entry => tripCounts.value[entry.key] > 0 },
  { key: 'missing', label: '缺原件', test: entry => attachmentsReady.value && !attachmentKeys.value.has(entry.key) },
  { key: 'buyer', label: '购方异常', test: entry => matchesBuyerCheck(buyerChecker.value(entry), 'issues') },
  { key: 'red', label: '红字票', test: entry => Boolean(redInvoiceStatus(entry)) },
];
const buyerOptions = computed(() => [...new Set([...directory.buyers, ...entries.value.map(entry => resolveArchiveName('buyers', entry.buyer))].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')));
const invalidRange = computed(() => {
  const { min, max, startDate, endDate } = filters.value;
  if (startDate && endDate && startDate > endDate) return '开始日期不能晚于结束日期。';
  if (min !== '' && max !== '' && Number(min) > Number(max)) return '最小金额不能大于最大金额。';
  return '';
});
const baseResults = computed(() => {
  const { project, buyer, startDate, endDate, selection, reimbursement, red, attachment,
    amountField, supplementOnly, buyerCheck } = filters.value;
  const query = queryFilter.value, min = minFilter.value, max = maxFilter.value, amountQuery = amountFilter.value;
  if (invalidRange.value) return [];
  const q = query.trim().toLowerCase();
  return entries.value.filter(e => {
    if (!matchesInvoiceAmount(e, amountQuery, amountField)) return false;
    const amount = Number(e[amountField]);
    if (min !== '' || max !== '') {
      if (e[amountField] === '' || e[amountField] == null || !Number.isFinite(amount)) return false;
      if ((min !== '' && amount < Number(min)) || (max !== '' && amount > Number(max))) return false;
    }
    if (supplementOnly && !supplementCounts.value[e.key]) return false;
    if (!matchesBuyerCheck(buyerChecker.value(e), buyerCheck)) return false;
    if (project && !projectRows(e).some(row => resolveArchiveName('projects', row.project) === project)) return false;
    if (buyer && normalizeBuyerName(resolveArchiveName('buyers', e.buyer)) !== normalizeBuyerName(buyer)) return false;
    const date = String(e.date || '').slice(0, 10);
    if ((startDate && (!date || date < startDate)) || (endDate && (!date || date > endDate))) return false;
    if (q) {
      const details = Array.isArray(e.details) ? e.details.map(line => line.service) : [];
      const text = [
        e.number, e.seller, e.buyer, e.type, e.reimburser, projectNames(e), e.purpose, e.tags,
        resolveArchiveName('buyers', e.buyer), resolveArchiveName('projects', e.project),
        e.service, e.remark, e.assignmentNote, ...details,
      ].join(' ').toLowerCase();
      if (!q.split(/\s+/).every(word => text.includes(word))) return false;
    }
    const official = deductionStatus(e);
    if (selection === 'selected' && official !== '已抵税') return false;
    if (selection === 'unselected' && official !== '未勾选') return false;
    if (selection === 'unknown' && official !== '未知') return false;
    if (reimbursement !== 'all' && (e.reimbursement || '未核对') !== reimbursement) return false;
    if (red === 'red' && !redInvoiceStatus(e)) return false;
    if (red === 'normal' && redInvoiceStatus(e)) return false;
    if (attachment === 'yes' && !attachmentKeys.value.has(e.key)) return false;
    if (attachment === 'no' && (!attachmentsReady.value || attachmentKeys.value.has(e.key))) return false;
    return true;
  });
});
const presetCounts = computed(() => Object.fromEntries(presets.map(({ key, test }) => [key, baseResults.value.filter(test).length])));
const filtered = computed(() => {
  const list = baseResults.value.filter(presets.find(({ key }) => key === filters.value.preset).test);
  const direction = sortDir.value === "asc" ? 1 : -1;
  return list.slice().sort((a, b) => {
    const key = sortKey.value;
    if (["amount", "tax", "total"].includes(key)) return ((Number(a[key]) || 0) - (Number(b[key]) || 0)) * direction;
    return String(a[key] || "").localeCompare(String(b[key] || ""), "zh-CN") * direction;
  });
});
const totals = computed(() => filtered.value.reduce((a, e) => {
  for (const k of ["amount", "tax", "total", "validTax"]) if (e[k] !== "" && e[k] != null) { a[k] += Number(e[k]) || 0; a[`${k}Count`]++; }
  return a;
}, { amount: 0, tax: 0, total: 0, validTax: 0, amountCount: 0, taxCount: 0, totalCount: 0, validTaxCount: 0 }));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const paged = computed(() => filtered.value.slice((Math.min(page.value, pageCount.value) - 1) * pageSize.value, Math.min(page.value, pageCount.value) * pageSize.value));
const allPageChecked = computed(() => paged.value.length > 0 && paged.value.every(e => checkedKeys.value.includes(e.key)));
const somePageChecked = computed(() => paged.value.some(e => checkedKeys.value.includes(e.key)));
function togglePage(checked) {
 const pageKeys = paged.value.map(e=>e.key);
 checkedKeys.value = checked ? [...new Set([...checkedKeys.value,...pageKeys])] : checkedKeys.value.filter(k=>!pageKeys.includes(k));
}
async function deleteEntries(keys) {
 const actual = [...new Set(keys)].filter(k=>Object.hasOwn(invoiceStore.ledger,k));
 if(!actual.length || !await requestConfirmation('删除 '+actual.length+' 张发票','记录将退出台账、汇总和导出，原件保留，可在回收站恢复。'))return;
 try{const r=invoiceActions.deleteLedgerEntries(actual);notice.value=r.warning || '';checkedKeys.value=[];}catch(e){notice.value='删除失败，原记录仍保留：'+e.message;}
}
function restoreEntries(ids) {
 try{const r=invoiceActions.restoreLedgerEntries(ids);trashNotice.value='已恢复 '+r.changed+' 张'+(r.conflicts?'；'+r.conflicts+' 张同号码已存在，未覆盖':'')+'。'+(r.warning||'');notice.value=trashNotice.value;}catch(e){trashNotice.value='恢复失败，回收站备份仍保留：'+e.message;}
}
watch(filtered, rows => {const visible=new Set(rows.map(e=>e.key));checkedKeys.value=checkedKeys.value.filter(k=>visible.has(k));});
watch(pageCount, count => {page.value=Math.min(page.value,count);});
function setSort(key) { if (sortKey.value === key) sortDir.value = sortDir.value === "asc" ? "desc" : "asc"; else { sortKey.value = key; sortDir.value = "desc"; } }
function sortIcon(key) { return sortKey.value === key ? (sortDir.value === "asc" ? "↑" : "↓") : "↕"; }
function resetFilters() { filters.value = { ...defaultFilters }; }
async function refreshAttachments() {
  try {
    const rows = await listLedgerAttachmentMetadata();
    attachmentKeys.value = new Set(rows.filter(row => row.hasOriginal).map(row => row.key));
    supplementCounts.value = Object.fromEntries(rows.map(row => [row.key, row.supplements.length]));
    tripCounts.value = Object.fromEntries(rows.map(row => [row.key, row.supplements.filter(item => /行程单/.test([item.type, item.name].filter(Boolean).join(' '))).length]));
    attachmentsReady.value = true;
    attachmentVersion.value++;
  }
  catch (err) { notice.value = `无法读取原件：${err.message || err}`; }
}
async function syncCurrent() {
  syncing.value = true;
  try {
    const { saved, needsReview, failed } = await invoiceActions.syncMatchedAttachments();
    await refreshAttachments();
    notice.value = `同步完成：关联 ${saved} 张${needsReview ? `，${needsReview} 张信息不一致或号码不唯一，需手动核对` : ""}${failed ? `，${failed} 张保存失败` : ""}。`;
  } finally { syncing.value = false; }
}
watch([filters, buyerChecker, pageSize, sortKey, sortDir], () => { page.value = 1; }, { deep: true });
watch(() => invoiceStore.attachmentVersion, refreshAttachments);
onMounted(refreshAttachments);
</script>

<template>
  <section class="ledger-workspace" aria-label="历史进项台账列表">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <InvoiceLedgerFilters @apply-input="flushFilters" v-model="filters" :presets="presets" :counts="presetCounts" :projects="projectOptions"
      :buyers="buyerOptions" :buyers-configured="buyersConfigured" :buyer-counts="buyerCounts" :has-filters="hasFilters" @reset="resetFilters" @scan="scanBuyers">
      <button v-if="eligibleCount || syncing" type="button" class="ui-btn" :disabled="syncing" @click="syncCurrent">{{ syncing ? '正在同步…' : '同步原件 ('+eligibleCount+')' }}</button>
      <button type="button" class="ui-btn ml-auto" @click="openTrash">回收站（{{ invoiceStore.ledgerTrash.length }}）</button>
    </InvoiceLedgerFilters>
    <p v-if="invalidRange" class="ledger-notice" role="alert">{{ invalidRange }}</p>
    <p v-if="notice" class="ledger-notice" role="status">{{ notice }}<button aria-label="关闭提示" class="ui-focus ml-auto" @click="notice=''">×</button></p>
    <p v-else-if="invoiceStore.attachmentSync && invoiceStore.invoices.length" class="ledger-notice" role="status">
      自动匹配 {{ invoiceStore.attachmentSync.matched }} 张，新增关联 {{ invoiceStore.attachmentSync.saved }} 张<span v-if="invoiceStore.attachmentSync.needsReview">，{{ invoiceStore.attachmentSync.needsReview }} 张需人工核对</span><span v-if="invoiceStore.attachmentSync.failed">，{{ invoiceStore.attachmentSync.failed }} 张保存失败</span>。
    </p>
    <InvoiceLedgerTotals :totals="totals" :count="filtered.length" :project="filters.project" :project-total="filteredProjectTotal" />
    <div v-if="checkedEntries.length" class="ledger-delete-tools flex flex-wrap items-center gap-2 border-y border-line bg-brand-soft px-3 py-1.5">
      <strong class="ui-money mr-1 text-xs">已选 {{ checkedEntries.length }} 张 <span class="font-normal">（合计 ¥{{ money(checkedTotal) }}）</span></strong>
      <button class="ui-btn-primary" @click="printEntries = checkedEntries.slice()">批量打印排版预览</button>
      <button class="ui-btn" @click="reviewSelection">查看所选</button>
      <button class="ui-btn" @click="openBatch('project')">批量改工地</button>
      <button class="ui-btn" @click="openBatch('reimburse')">批量标记已报销</button>
      <button class="ui-btn-danger" @click="deleteEntries(checkedKeys)">批量删除</button>
      <button class="ui-btn-ghost" @click="checkedKeys=[]">清空选择</button>
    </div>
    <div class="ledger-body">
      <div class="ledger-table-wrap" tabindex="0" aria-label="发票列表，可上下及左右滚动">
        <table class="ledger-table">
          <thead><tr>
            <th scope="col" class="ledger-select"><input type="checkbox" :disabled="filtersPending || !paged.length" aria-label="全选当前页" :checked="allPageChecked" :indeterminate="somePageChecked && !allPageChecked" @change="togglePage($event.target.checked)" /></th>
            <th v-for="[key, label] in invoiceExpenseColumns" :key="key" scope="col" :class="{ numeric: key === 'total' }" :aria-sort="sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined"><button class="ui-focus" @click="setSort(key)">{{ label }} {{ sortIcon(key) }}</button></th>
            <th scope="col">购买方</th><th scope="col">复核状态</th><th scope="col">报销状态</th><th scope="col">发票状态</th><th scope="col">抵扣 / 勾选时间</th><th scope="col">原件</th><th scope="col">附件</th><th scope="col" class="sticky-action">操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="e in paged" :key="e.key" :class="{ active: selectedKey === e.key }">
              <td class="ledger-select"><input v-model="checkedKeys" type="checkbox" :disabled="filtersPending" :value="e.key" :aria-label="'选择发票 '+e.number" /></td>
              <td v-for="[key] in invoiceExpenseColumns" :key="key" :class="{numeric:key==='total',number:key==='number'}"><InvoiceTypeTags v-if="key==='type'" :entry="e" /><span v-else-if="key==='project' && isMultiProject(e)" class="multi-project-cell"><MiddleEllipsis :text="projectNames(e) || '尚未指定工地'" :tail="4" class="ledger-short-text" /><small :class="projectAllocationState(e).complete ? 'allocation-complete' : 'allocation-incomplete'">{{ projectAllocationState(e).label }} · {{ (e.projectAllocations || []).length }} 个工地</small></span><MiddleEllipsis v-else-if="['seller','project','payer','number'].includes(key)" :text="String(e[key] || '—')" :tail="key === 'seller' ? 5 : 6" :class="key==='seller'?'ledger-company-text':'ledger-short-text'" /><template v-else>{{ key==='total'?money(e[key]):e[key]||'—' }}</template></td>
              <td><MiddleEllipsis :text="e.buyer || '—'" :tail="5" class="ledger-company-text" /><small v-if="['missing','unmatched'].includes(buyerChecker(e))" class="buyer-issue">{{ buyerCheckLabels[buyerChecker(e)] }}</small></td>
              <td><span class="status-pill" :class="invoiceProblems(e).length?'warning':'neutral'">{{ invoiceProblems(e).length?'待补全':e.reviewedAt?'已复核':'待复核' }}</span></td>
              <td><span class="status-pill" :class="e.reimbursement==='已报销'?'success':'neutral'">{{ e.reimbursement||'未核对' }}</span></td>
              <td><InvoiceStatusTags :entry="e" /></td>
              <td :title="deductionDisplay(e).title"><span v-if="deductionDisplay(e).hasTime">{{ deductionDisplay(e).label }}</span><UiTag v-else :tone="deductionDisplay(e).label==='已抵扣'?'green':'neutral'">{{ deductionDisplay(e).label }}</UiTag></td>
              <td>{{ attachmentKeys.has(e.key)?'已关联':'未关联' }}</td>
              <td><button v-if="supplementCounts[e.key]" type="button" class="detail-link" :aria-label="'查看 '+e.number+' 的附件'" @click="openDetail(e,'first')">附件 {{ supplementCounts[e.key] }} 份</button><span v-else>无附件</span></td>
              <td class="sticky-action">
                <button class="detail-link ui-focus" @click="openDetail(e)">详情</button>
                <button class="detail-link ui-focus" @click="openDetail(e, '', true)">编辑</button>
                <button class="detail-link ui-focus text-danger" @click="deleteEntries([e.key])">删除</button>
              </td>
            </tr>
            <tr v-if="!paged.length"><td :colspan="invoiceExpenseColumns.length + 9" class="py-10 text-center text-ink-soft">没有符合条件的发票记录，请导入清单或调整筛选。</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <footer class="ledger-footer flex flex-wrap items-center gap-2 border-t border-line bg-surface px-3 py-1.5 text-xs text-ink-secondary">
      <span class="mr-auto ui-money">共 {{ filtered.length }} 条记录 · 已选 {{ checkedEntries.length }} 条</span>
      <label>每页 <select v-model.number="pageSize" class="ui-input w-17"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select></label>
      <button class="ui-btn" :disabled="page <= 1" @click="page--">上一页</button>
      <span class="ui-money">{{ Math.min(page, pageCount) }} / {{ pageCount }}</span>
      <button class="ui-btn" :disabled="page >= pageCount" @click="page++">下一页</button>
    </footer>
    <InvoiceLedgerBatchDialog v-if="batch" :action="batch.action" :entries="batch.entries" @close="batch=null" @saved="notice=$event; batch=null" />
    <InvoiceLedgerRecycleBin v-model="trashOpen" :records="invoiceStore.ledgerTrash" :ledger="invoiceStore.ledger" :message="trashNotice" :busy="invoiceStore.purgingTrash" :pending-cleanup="pendingCleanup" @restore="restoreEntries" @purge="purgeEntries" @retry="purgeEntries([])" />
    <LedgerPrintPreview v-if="printEntries.length" :entries="printEntries" @close="printEntries=[]" />
    <DialogRoot :open="!!selected" @update:open="value => { if (!value) selectedKey = '' }">
      <DialogPortal><DialogOverlay class="ui-overlay z-50" />
        <DialogContent class="ui-dialog ledger-detail-dialog z-51 flex flex-col overflow-hidden w-[92vw] max-w-[1120px] h-[86vh]" :aria-describedby="undefined">
          <DialogTitle class="sr-only">发票详情</DialogTitle>
          <InvoiceLedgerDetail v-if="selected" :key="selectedKey" :entry="selected" :initial-supplement="initialSupplement"
            :edit-initially="editInitially" :version="attachmentVersion" @close="selectedKey = ''" @attachment-change="refreshAttachments">
            <template #navigation>
              <nav class="flex flex-wrap items-center gap-2" aria-label="浏览发票">
                <button class="ui-btn-sm" :disabled="reviewIndex <= 0" @click="moveDetail(-1)">上一张</button>
                <span class="ui-money text-xs text-ink-soft" aria-live="polite">{{ reviewingSelection ? '所选第' : '第' }} {{ reviewIndex + 1 }} / {{ reviewKeys.length }} 张</span>
                <button class="ui-btn-sm" :disabled="reviewIndex < 0 || reviewIndex >= reviewKeys.length - 1" @click="moveDetail(1)">下一张</button>
              </nav>
            </template>
          </InvoiceLedgerDetail>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </section>
</template>

<style scoped>
.ledger-workspace { display:flex; flex:1; flex-direction:column; min-height:0; min-width:0; overflow:auto; background:white; border:1px solid #e3e6ea; border-radius:10px; }
.ledger-workspace > :not(.ledger-body) { flex-shrink:0; }
.ledger-body { display:flex; flex:1; min-width:0; min-height:9rem; }
.ledger-table-wrap { flex:1; min-width:0; overflow:auto; overscroll-behavior:contain; }
.ledger-table { min-width:max(100%,1040px); width:max-content; border-collapse:separate; border-spacing:0; text-align:left; white-space:nowrap; }
.ledger-table th,.ledger-table td { padding:5px 6px; height:36px; border-bottom:1px solid #eef0f3; }
.ledger-table th { position:sticky; top:0; z-index:1; background:#f9fafb; color:#4b5563; font-size:12px; font-weight:600; }
.ledger-table tr:hover td,.ledger-table tr.active td { background:#f0f6ff; }
.ledger-table .ledger-select,.ledger-table .sticky-action { position:sticky; z-index:2; background:white; }
.ledger-table th.ledger-select,.ledger-table th.sticky-action { z-index:3; background:#f9fafb; }
.ledger-select { left:0; text-align:center; border-right:1px solid #e3e6ea; }
.sticky-action { right:0; border-left:1px solid #e3e6ea; }
.ledger-company-text { width:185px; }
.ledger-short-text { width:112px; }
.ledger-table small { display:block; font-size:11px; }
.allocation-complete { color:#166534; }
.allocation-incomplete,.ledger-table .buyer-issue { color:#92400e; }
.multi-project-cell { display:flex; flex-direction:column; }
.ledger-table .numeric,.ledger-table .number { font-variant-numeric:tabular-nums; }
.ledger-table .numeric { text-align:right; }
.detail-link { padding:3px 5px; color:#1867c0; white-space:nowrap; }
.detail-link.text-danger { color:#b91c1c; }
.detail-link:hover { text-decoration:underline; }
.ledger-notice { display:flex; align-items:center; gap:8px; padding:4px 12px; background:#fffbeb; color:#92400e; font-size:12px; }
</style>

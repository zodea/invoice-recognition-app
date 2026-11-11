<script setup>
import InvoiceProjectAllocationDialog from './InvoiceProjectAllocationDialog.vue';
import { directory } from '../lib/expense-directory.js';
import { allocationKind } from '../lib/payment-records.js';
import { projectNames, isMultiProject, projectAllocationState, projectExpenseRows } from '../lib/invoice-allocation.js';
import ConfirmAction from './ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
import InvoiceLedgerRecycleBin from './InvoiceLedgerRecycleBin.vue';
import { readTrashCleanupQueue } from '../lib/ledger-trash-purge.js';
import MiddleEllipsis from './MiddleEllipsis.vue';
import InvoiceBuyerCheck from './InvoiceBuyerCheck.vue';
import { useBuyerCheck } from '../composables/useBuyerCheck.js';
import { buyerCheckLabels, matchesBuyerCheck } from '../lib/invoice-buyer-check.js';
import InvoiceStatusTags from "./InvoiceStatusTags.vue";
import UiTag from "./UiTag.vue";
import { deductionDisplay } from "../lib/invoice-status-display";
import InvoiceTypeTags from "./InvoiceTypeTags.vue";
import { invoiceExpenseColumns } from "../lib/expense-columns";
import { invoiceProblems } from "../lib/invoice-review";
import AppIcon from "./AppIcon.vue";
import { computed, onMounted, ref, watch } from "vue";
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { invoiceActions, invoiceStore } from "../invoiceStore";
import { deductionStatus, redInvoiceStatus } from "../lib/invoice-ledger";
import { planLedgerMatches } from "../lib/ledger-matching";
import { listLedgerAttachmentKeys } from "../lib/ledger-attachments";
import InvoiceLedgerDetail from "./InvoiceLedgerDetail.vue";

const props = defineProps({ initialBuyerCheck: { type: String, default: 'all' } });
const buyerCheckFilter = ref(props.initialBuyerCheck);
const { checker: buyerChecker, configured: buyersConfigured, counts: buyerCounts } = useBuyerCheck(() => entries.value);
function scanBuyers() { resetFilters(); buyerCheckFilter.value = 'issues'; }
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
const allocationKey = ref('');
const allocationEntry = computed(() => invoiceStore.ledger[allocationKey.value] || null);
const editInitially = ref(false);
const query = ref("");
const projectFilter = ref('');
const projectRows = entry => isMultiProject(entry) ? projectExpenseRows(entry) : allocationKind(entry) === '指定工地' ? projectExpenseRows(entry) : [];
const projectOptions = computed(() => [...new Set([...directory.projects, ...entries.value.flatMap(entry => projectRows(entry).map(row => row.project))].filter(Boolean))]);
const filteredProjectTotal = computed(() => filtered.value.reduce((sum, entry) => sum + projectRows(entry).filter(row => row.project === projectFilter.value).reduce((subtotal,row) => subtotal + Math.round(row.total * 100),0),0) / 100);
const startDate = ref("");
const endDate = ref("");
const selection = ref("all");
const reimbursement = ref("all");
const redFilter = ref("all");
const attachmentFilter = ref("all");
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
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const list = entries.value.filter(e => {
    if (!matchesBuyerCheck(buyerChecker.value(e), buyerCheckFilter.value)) return false;
    if (projectFilter.value && !projectRows(e).some(row => row.project === projectFilter.value)) return false;
    const date = String(e.date || "").slice(0, 10);
    if (startDate.value && (!date || date < startDate.value)) return false;
    if (endDate.value && (!date || date > endDate.value)) return false;
    if (q && !`${e.number || ""} ${e.seller || ""} ${e.buyer || ""} ${e.type || ""} ${e.reimburser || ""} ${projectNames(e)} ${e.purpose || ""} ${e.tags || ""}`.toLowerCase().includes(q)) return false;
    const official = deductionStatus(e);
    if (selection.value === "selected" && official !== "已抵税") return false;
    if (selection.value === "unselected" && official !== "未勾选") return false;
    if (selection.value === "unknown" && official !== "未知") return false;
    if (reimbursement.value !== "all" && (e.reimbursement || "未核对") !== reimbursement.value) return false;
    if (redFilter.value === "red" && !redInvoiceStatus(e)) return false;
    if (redFilter.value === "normal" && redInvoiceStatus(e)) return false;
    if (attachmentFilter.value === "yes" && !attachmentKeys.value.has(e.key)) return false;
    if (attachmentFilter.value === "no" && attachmentKeys.value.has(e.key)) return false;
    return true;
  });
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
function togglePage(checked) {
 const pageKeys = paged.value.map(e=>e.key);
 checkedKeys.value = checked ? [...new Set([...checkedKeys.value,...pageKeys])] : checkedKeys.value.filter(k=>!pageKeys.includes(k));
}
async function deleteEntries(keys) {
 const actual = [...new Set(keys)].filter(k=>Object.hasOwn(invoiceStore.ledger,k));
 if(!actual.length || !await requestConfirmation('删除 '+actual.length+' 张发票','记录将退出台账、汇总和导出，原件保留，可在回收站恢复。'))return;
 try{const r=invoiceActions.deleteLedgerEntries(actual);notice.value='已将 '+r.changed+' 张发票移入回收站。'+(r.warning||'');checkedKeys.value=[];}catch(e){notice.value='删除失败，原记录仍保留：'+e.message;}
}
function restoreEntries(ids) {
 try{const r=invoiceActions.restoreLedgerEntries(ids);trashNotice.value='已恢复 '+r.changed+' 张'+(r.conflicts?'；'+r.conflicts+' 张同号码已存在，未覆盖':'')+'。'+(r.warning||'');notice.value=trashNotice.value;}catch(e){trashNotice.value='恢复失败，回收站备份仍保留：'+e.message;}
}
watch(filtered, rows => {const visible=new Set(rows.map(e=>e.key));checkedKeys.value=checkedKeys.value.filter(k=>visible.has(k));});
watch(pageCount, count => {page.value=Math.min(page.value,count);});
const money = n => n === "" || n == null ? "—" : Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function setSort(key) { if (sortKey.value === key) sortDir.value = sortDir.value === "asc" ? "desc" : "asc"; else { sortKey.value = key; sortDir.value = "desc"; } }
function sortIcon(key) { return sortKey.value === key ? (sortDir.value === "asc" ? "↑" : "↓") : "↕"; }
function resetFilters() { projectFilter.value = ''; buyerCheckFilter.value = 'all'; query.value = ""; startDate.value = ""; endDate.value = ""; selection.value = "all"; reimbursement.value = "all"; redFilter.value = "all"; attachmentFilter.value = "all"; }
async function refreshAttachments() {
  try { attachmentKeys.value = new Set(await listLedgerAttachmentKeys()); attachmentVersion.value++; }
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
watch([buyerCheckFilter, buyerChecker, query, projectFilter, startDate, endDate, selection, reimbursement, redFilter, attachmentFilter, pageSize, sortKey, sortDir], () => { page.value = 1; });
watch(() => invoiceStore.attachmentVersion, refreshAttachments);
onMounted(refreshAttachments);
</script>

<template>
  <section class="ledger-workspace" aria-label="历史进项台账列表">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
        <header class="ledger-header">
          <h2 class="ledger-title">发票列表 <small>共 {{ entries.length }} 张</small></h2>
          <InvoiceBuyerCheck compact v-model="buyerCheckFilter" :configured="buyersConfigured" :counts="buyerCounts" @scan="scanBuyers" />
          <button class="btn" v-if="eligibleCount || syncing" :disabled="syncing" @click="syncCurrent">{{ syncing ? '正在同步…' : '同步原件 ('+eligibleCount+')' }}</button>
        </header>
        <div class="ledger-delete-tools"><label><input type="checkbox" :checked="allPageChecked" :disabled="!paged.length" @change="togglePage($event.target.checked)" />全选当前页</label><span>已选 {{ checkedKeys.length }} 张</span><button class="btn-danger" :disabled="!checkedKeys.length" @click="deleteEntries(checkedKeys)">删除所选</button><button v-if="checkedKeys.length" class="btn" @click="checkedKeys=[]">取消选择</button><button class="btn trash-entry" @click="openTrash">回收站（{{ invoiceStore.ledgerTrash.length }}）</button></div>
        <div class="ledger-filters">
          <label class="search">搜索<input v-model="query" class="field-input" placeholder="发票号码、公司、项目或标签" /></label>
          <label>使用工地<select v-model="projectFilter" class="field-input"><option value="">全部</option><option v-for="value in projectOptions" :key="value">{{ value }}</option></select></label>
          <label>开票日期从<input v-model="startDate" class="field-input" type="date" /></label><label>至<input v-model="endDate" class="field-input" type="date" :min="startDate || undefined" /></label>
          <label>抵税状态<select v-model="selection" class="field-input"><option value="all">全部</option><option value="selected">已抵税</option><option value="unselected">未勾选</option><option value="unknown">未知</option></select></label>
          <label>报销核对<select v-model="reimbursement" class="field-input"><option value="all">全部</option><option>未核对</option><option>已报销</option><option>未报销</option></select></label>
          <label>红字状态<select v-model="redFilter" class="field-input"><option value="all">全部</option><option value="red">红字 / 冲红</option><option value="normal">无红字标记</option></select></label>
          <label>原件<select v-model="attachmentFilter" class="field-input"><option value="all">全部</option><option value="yes">已关联</option><option value="no">未关联</option></select></label><button class="btn reset" @click="resetFilters">重置</button>
        </div>
        <div v-if="startDate && endDate && startDate > endDate" class="ledger-notice">开始日期不能晚于结束日期。</div><div v-if="notice" class="ledger-notice" role="status">{{ notice }}<button aria-label="关闭提示" class="notice-close" @click="notice=''">×</button></div><div v-else-if="invoiceStore.attachmentSync && invoiceStore.invoices.length" class="ledger-notice" role="status">自动匹配 {{ invoiceStore.attachmentSync.matched }} 张，新增关联 {{ invoiceStore.attachmentSync.saved }} 张<span v-if="invoiceStore.attachmentSync.needsReview">，{{ invoiceStore.attachmentSync.needsReview }} 张需人工核对</span><span v-if="invoiceStore.attachmentSync.failed">，{{ invoiceStore.attachmentSync.failed }} 张保存失败</span>。</div>
        <div class="ledger-summary"><span>筛选结果 <b>{{ filtered.length }}</b> 张</span><span>金额 <b>{{ totals.amountCount ? money(totals.amount) : '—' }}</b></span><span>税额 <b>{{ totals.taxCount ? money(totals.tax) : '—' }}</b></span><span>{{ projectFilter ? '整票价税合计' : '价税合计' }} <b>{{ totals.totalCount ? money(totals.total) : '—' }}</b><small v-if="totals.totalCount < filtered.length">（{{ filtered.length - totals.totalCount }} 张缺失）</small></span><span v-if="projectFilter">{{ projectFilter }}分配金额 <b>{{ money(filteredProjectTotal) }}</b></span><span>有效抵扣税额 <b>{{ totals.validTaxCount ? money(totals.validTax) : '—' }}</b><small v-if="totals.validTaxCount < filtered.length">（{{ filtered.length - totals.validTaxCount }} 张缺失）</small></span></div>

        <div class="ledger-body"><div class="ledger-table-wrap" tabindex="0" aria-label="发票列表，可左右滚动"><table class="ledger-table finance-table"><thead><tr><th class="sticky-action">操作</th><th v-for="[key,label] in invoiceExpenseColumns" :key="key" :class="{numeric:key==='total'}"><button @click="setSort(key)">{{ label }} {{ sortIcon(key) }}</button></th><th>购买方</th><th>复核状态</th><th>报销状态</th><th>发票状态</th><th>抵扣 / 勾选时间</th><th>原件</th></tr></thead><tbody><tr v-for="e in paged" :key="e.key" :class="{active:selectedKey===e.key}"><td class="sticky-action"><input v-model="checkedKeys" type="checkbox" :value="e.key" :aria-label="'选择发票 '+e.number" /><button class="detail-link" @click="editInitially=false;selectedKey=e.key">详情</button><button class="detail-link" @click="editInitially=true;selectedKey=e.key"><AppIcon name="edit" :size="14" /> 编辑</button><button class="detail-link" @click="allocationKey=e.key">分配</button><button class="detail-link delete-link" @click="deleteEntries([e.key])">删除</button></td><td v-for="[key] in invoiceExpenseColumns" :key="key" :class="{numeric:key==='total',number:key==='number'}"><InvoiceTypeTags v-if="key==='type'" :entry="e" /><span v-else-if="key==='project' && isMultiProject(e)" class="multi-project-cell"><MiddleEllipsis :text="projectNames(e) || '尚未指定工地'" :tail="4" class="ledger-short-text" /><small :class="projectAllocationState(e).complete ? 'allocation-complete' : 'allocation-incomplete'">{{ projectAllocationState(e).label }} · {{ (e.projectAllocations || []).length }} 个工地</small></span><MiddleEllipsis v-else-if="['seller','project','payer'].includes(key)" :text="String(e[key] || '—')" :tail="6" :class="key==='seller'?'ledger-company-text':'ledger-short-text'" /><template v-else>{{ key==='total'?money(e[key]):e[key]||'—' }}</template></td><td><MiddleEllipsis :text="e.buyer || '—'" :tail="6" class="ledger-company-text" /><small v-if="['missing','unmatched'].includes(buyerChecker(e))" class="buyer-issue">{{ buyerCheckLabels[buyerChecker(e)] }}</small></td><td><span class="status-pill" :class="invoiceProblems(e).length?'warning':'neutral'">{{ invoiceProblems(e).length?'待补全':e.reviewedAt?'已复核':'待复核' }}</span></td><td><span class="status-pill" :class="e.reimbursement==='已报销'?'success':'neutral'">{{ e.reimbursement||'未核对' }}</span></td><td><InvoiceStatusTags :entry="e" /></td><td :title="deductionDisplay(e).title"><span v-if="deductionDisplay(e).hasTime">{{ deductionDisplay(e).label }}</span><UiTag v-else :tone="deductionDisplay(e).label==='已抵扣'?'green':'neutral'">{{ deductionDisplay(e).label }}</UiTag></td><td>{{ attachmentKeys.has(e.key)?'已关联':'未关联' }}</td></tr><tr v-if="!paged.length"><td :colspan="invoiceExpenseColumns.length + 7" class="empty">没有符合条件的发票记录，请导入清单或调整筛选。</td></tr></tbody></table></div></div>
        <footer class="ledger-footer"><span>{{ projectFilter ? '已单列本工地分配金额，表格金额和税额仍为整票数据。' : '合计仅统计已有金额；空值以“—”显示。' }}</span><label>每页 <select v-model.number="pageSize" class="field-input"><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select></label><button class="btn" :disabled="page <= 1" @click="page--">上一页</button><span>{{ Math.min(page, pageCount) }} / {{ pageCount }}</span><button class="btn" :disabled="page >= pageCount" @click="page++">下一页</button></footer>
        <InvoiceLedgerRecycleBin v-model="trashOpen" :records="invoiceStore.ledgerTrash" :ledger="invoiceStore.ledger" :message="trashNotice" :busy="invoiceStore.purgingTrash" :pending-cleanup="pendingCleanup" @restore="restoreEntries" @purge="purgeEntries" @retry="purgeEntries([])" />
        <InvoiceProjectAllocationDialog v-if="allocationEntry" :entry="allocationEntry" @close="allocationKey=''" />
        <DialogRoot :open="!!selected" @update:open="value => { if (!value) selectedKey = '' }"><DialogPortal><DialogOverlay class="drawer-overlay" /><DialogContent class="drawer-content"><DialogTitle class="sr-only">发票详情</DialogTitle><InvoiceLedgerDetail v-if="selected" :entry="selected" :edit-initially="editInitially" :version="attachmentVersion" @close="selectedKey = ''" @attachment-change="refreshAttachments" /></DialogContent></DialogPortal></DialogRoot>
  </section>
</template>

<style scoped>
.multi-project-cell{display:flex;flex-direction:column;gap:1px}.allocation-complete{color:#16803b}.allocation-incomplete{color:#a15c08}
.ledger-delete-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 20px;border-bottom:1px solid #e3e9f0;font-size:12px}.ledger-delete-tools label{display:flex;align-items:center;gap:6px}.ledger-table .delete-link{color:#b91c1c}
.ledger-company-text{width:220px;max-width:220px}.ledger-short-text{width:120px;max-width:120px}
.ledger-table .buyer-issue{color:#a15c08}
.ledger-dialog{width:min(1500px,96vw);height:min(860px,92vh);display:flex;flex-direction:column;border-radius:12px;overflow:hidden}.ledger-header{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:17px 20px;border-bottom:1px solid #e3e9f0;background:white}.ledger-title{font-size:18px;font-weight:700;margin:0;color:#172033}.ledger-header p{font-size:12px;color:#64748b;margin:5px 0 0}.header-actions{display:flex;gap:8px}.ledger-filters{display:flex;align-items:end;flex-wrap:wrap;gap:9px;padding:12px 20px;background:#f8fafc}.ledger-filters label{display:grid;gap:4px;color:#64748b;font-size:11px}.ledger-filters input,.ledger-filters select{height:32px;max-width:150px}.ledger-filters .search input{width:220px;max-width:none}.ledger-filters .reset{height:32px}.ledger-summary{display:flex;align-items:center;flex-wrap:wrap;gap:20px;padding:11px 20px;border-block:1px solid #e3e9f0;background:#fff;color:#64748b;font-size:12px}.ledger-summary b{color:#172033;font-size:13px;font-variant-numeric:tabular-nums}.ledger-summary small{margin-left:4px;color:#9a6700}.ledger-notice{padding:7px 20px;background:#fffbeb;color:#92400e;font-size:12px}.ledger-body{display:flex;flex:1;min-height:0}.ledger-table-wrap{flex:1;min-width:0;overflow:auto;background:#fff}.ledger-table{border-collapse:collapse;width:100%;font-size:12px}.ledger-table th{position:sticky;top:0;z-index:1;background:#f8fafc;color:#64748b;font-weight:600;text-align:left;white-space:nowrap;border-bottom:1px solid #dfe5ed}.ledger-table th,.ledger-table td{padding:10px 11px}.ledger-table th button{border:0;background:none;color:inherit;font:inherit;cursor:pointer;white-space:nowrap}.ledger-table td{border-bottom:1px solid #edf1f5;vertical-align:top;white-space:nowrap}.ledger-table tr:hover,.ledger-table tr.active{background:#f1f7ff}.ledger-table .company,.ledger-table .type{min-width:150px;max-width:220px;white-space:normal}.ledger-table small{display:block;margin-top:4px;color:#94a3b8}.ledger-table .number{font-variant-numeric:tabular-nums}.ledger-table .numeric{text-align:right;font-variant-numeric:tabular-nums}.ledger-table .strong{font-weight:700}.state,.red-state{display:inline-block;padding:3px 6px;border-radius:4px;background:#f1f5f9;color:#475569}.red-state{margin-left:4px;background:#fef2f2;color:#b91c1c}.detail-link{color:#2563eb;background:none;border:0;cursor:pointer;white-space:nowrap}.empty{text-align:center;color:#64748b;padding:45px!important}.ledger-footer{display:flex;align-items:center;gap:9px;padding:10px 20px;border-top:1px solid #e3e9f0;background:#f8fafc;color:#64748b;font-size:12px}.ledger-footer>span:first-child{margin-right:auto}.ledger-footer select{width:65px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.ledger-workspace{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;background:#fff;border:1px solid #dfe5ed;border-radius:10px;overflow:hidden}.ledger-body{flex:1;min-height:0;min-width:0}.ledger-table-wrap{width:100%;overflow:auto}.ledger-table{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0}.ledger-table td{height:46px;vertical-align:middle;white-space:nowrap}.ledger-table .secondary{color:#64748b}.ledger-table .sticky-action{position:sticky;left:0;z-index:2;background:#fff;border-right:1px solid #edf1f5}.ledger-table thead .sticky-action{z-index:3;background:#f8fafc}.ledger-table tr:hover .sticky-action,.ledger-table tr.active .sticky-action{background:#f1f7ff}.scroll-hint{padding:8px 20px;color:#64748b;font-size:11px;background:#fff}.drawer-overlay{position:fixed;inset:0;background:rgba(15,23,42,.42);z-index:50}.drawer-content{position:fixed;top:0;right:0;bottom:0;z-index:51;width:min(560px,94vw);background:#fff;box-shadow:-16px 0 42px rgba(15,23,42,.18);outline:none;overflow:hidden}.ledger-footer{flex-wrap:wrap}
.drawer-content{top:3vh;bottom:3vh;left:2vw;right:2vw;width:auto;max-width:1680px;margin:auto;border-radius:10px;box-shadow:0 20px 55px rgba(15,23,42,.25)}

/* 顶部控件保持紧凑，余下高度全部交给列表滚动。 */
.ledger-workspace > :not(.ledger-body){flex-shrink:0}
.ledger-header{justify-content:flex-start;flex-wrap:wrap;gap:8px 16px;padding:7px 12px;border-bottom:0}
.ledger-title{font-size:15px;white-space:nowrap}.ledger-title small{font-size:11px;font-weight:400;color:#64748b;margin-left:5px}
.ledger-delete-tools{padding:4px 12px 7px;gap:8px;border-bottom:1px solid #e3e9f0}.trash-entry{margin-left:auto}
.ledger-header .btn,.ledger-delete-tools button,.ledger-footer .btn{min-height:28px;padding:3px 8px;font-size:12px}
.ledger-filters{gap:6px 10px;padding:7px 12px;align-items:center}.ledger-filters label{display:flex;align-items:center;gap:5px;white-space:nowrap}.ledger-filters input,.ledger-filters select{height:28px;padding:3px 5px;font-size:12px;max-width:130px}.ledger-filters .search input{width:185px}.ledger-filters .reset{height:28px;min-height:28px;padding:3px 8px;font-size:12px}
.ledger-summary{gap:6px 16px;padding:6px 12px;font-size:11px}.ledger-summary b{font-size:12px}.ledger-notice{padding:4px 12px;font-size:11px;display:flex;align-items:center;gap:6px}.notice-close{margin-left:auto;background:none;border:0;cursor:pointer;font-size:17px;color:inherit}
.ledger-workspace .ledger-table th,.ledger-workspace .ledger-table td{padding:5px 8px;height:34px;box-sizing:border-box}.ledger-table small{margin-top:1px;font-size:10px}.ledger-workspace .ledger-table .sticky-action{padding-inline:7px}.ledger-table .detail-link{padding:3px 4px}.ledger-workspace .ledger-table :deep(.status-pill){padding:2px 5px;font-size:11px}
.ledger-footer{padding:5px 12px;gap:8px;font-size:11px}.ledger-footer select{height:28px;padding:3px 6px}
</style>

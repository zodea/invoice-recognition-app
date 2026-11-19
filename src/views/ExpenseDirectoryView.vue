<script setup>
import ExpenseSummaryDetails from '../components/ExpenseSummaryDetails.vue';
import ExpenseAssignmentImport from '../components/ExpenseAssignmentImport.vue';
import DirectoryTransfer from '../components/DirectoryTransfer.vue';
import { ref, computed, watch } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import MiddleEllipsis from '../components/MiddleEllipsis.vue';
import DirectoryRecordsDialog from '../components/DirectoryRecordsDialog.vue';
import { directory, saveDirectory } from '../lib/expense-directory';
import { invoiceStore } from '../invoiceStore.js';
import { paymentStore, countPaymentExpense } from '../lib/payment-store';
import { expenseSummary } from '../lib/expense-summary.js';
import { toast, toastError, toastWarn } from '../lib/toast';

const emit = defineEmits(['inspect-buyers']);
import { archiveKinds } from '../lib/directory-workbook.js';
const bySeller = ref(false);
const name = ref(''), kind = ref('buyers'), seller = ref(''), buyer = ref(''), project = ref('');
const recordsOpen = ref(false), recordsMode = ref('archives');
const archiveCount = computed(() => Object.keys(archiveKinds).reduce((count, key) => count + directory[key].length, 0));
function showRecords(mode) { recordsMode.value = mode; recordsOpen.value = true; }
watch(() => directory.buyers, values => { if (!values.includes(buyer.value)) buyer.value = ''; });
watch(() => directory.projects, values => { if (!values.includes(project.value)) project.value = ''; });
function add() {
  const value = name.value.trim();
  if (!value) { toastWarn('请填写档案名称'); return; }
  if (directory[kind.value].includes(value)) { toastWarn('该档案已存在，可在右上角档案清单查看'); return; }
  try {
    saveDirectory({ ...directory, [kind.value]: [...directory[kind.value], value], deletedArchives: directory.deletedArchives.filter(r => r.kind !== kind.value || r.value !== value) });
    name.value = '';
    toast('已添加'+archiveKinds[kind.value]+'，可在右上角档案清单查看');
  } catch (error) { toastError('保存失败：'+error.message); }
}
function rule() {
  if (!seller.value.trim() || !directory.buyers.includes(buyer.value) || !directory.projects.includes(project.value)) {
    toastWarn('请选择购买方和工地，并填写厂家'); return;
  }
  try {
    saveDirectory({ ...directory, rules: [...directory.rules.filter(r => !(r.seller === seller.value.trim() && r.buyer === buyer.value && r.project === project.value)), { seller: seller.value.trim(), buyer: buyer.value, project: project.value }] });
    toast('对应关系已保存');
  } catch (error) { toastError('保存失败：'+error.message); }
}
const groupBy = ref('both'), projectFilter = ref(''), allocationFilter = ref('');
const entries = computed(() => [...Object.values(invoiceStore.ledger), ...paymentStore.rows.filter(countPaymentExpense)]);
const groups = computed(() => expenseSummary(entries.value, false, { groupBy: 'both' }));
const optionsFor = (key, configured) => [...new Set([...configured, ...groups.value.map(row => row[key])])].sort((a,b) => a.localeCompare(b,'zh-CN'));
const projectOptions = computed(() => optionsFor('project', directory.projects));
const allocationOptions = computed(() => optionsFor('allocation', directory.allocations));
const summaryOptions = computed(() => ({ groupBy: groupBy.value, projectFilter: projectFilter.value, allocationFilter: allocationFilter.value }));
const summary = computed(() => expenseSummary(entries.value, bySeller.value, summaryOptions.value));
const detailGroup = ref(null);
const detailSources = computed(() => {
  if (!detailGroup.value) return [];
  const sources = [...Object.entries(invoiceStore.ledger).map(([key,entry]) => ({kind:'invoice',key,entry})),
    ...paymentStore.rows.filter(countPaymentExpense).map(entry => ({kind:'payment',key:entry.id,entry}))];
  return sources.filter(({entry}) => expenseSummary([entry], bySeller.value, summaryOptions.value).some(row =>
    ['buyer','project','allocation','seller'].every(k => row[k] === detailGroup.value[k])));
});


</script>

<template>
  <section class="expense-screen directory-screen">
    <header class="expense-heading">
      <h1>基础档案</h1>
      <div class="directory-entry-area">
        <span class="soft-badge"><AppIcon name="building" :size="16" />{{ directory.buyers.length }} 家公司 · {{ directory.projects.length }} 个工地</span>
        <div class="directory-entry-buttons">
          <DirectoryTransfer />
          <button class="btn" @click="showRecords('archives')"><AppIcon name="ledger" :size="16" />档案清单（{{ archiveCount }}）</button>
          <button class="btn" @click="showRecords('rules')"><AppIcon name="link" :size="16" />厂家归属清单（{{ directory.rules.length }}）</button>
          <button class="btn" @click="showRecords('trash')"><AppIcon name="trash" :size="16" />回收站（{{ directory.deletedArchives.length }}）</button>
        </div>
      </div>
    </header>
    <div class="directory-layout">
      <section class="finance-card">
        <header class="finance-card-heading"><AppIcon name="plus" /><h2>新增档案</h2></header>
        <div class="finance-card-body">
          <div class="form-grid"><label>档案类型<select v-model="kind"><option v-for="(label,key) in archiveKinds" :key="key" :value="key">{{ label }}</option></select></label><label>档案名称<input v-model="name" :placeholder="'输入'+archiveKinds[kind]+'名称'" @keyup.enter="add" /></label></div>
          <button class="btn-primary" @click="add"><AppIcon name="plus" :size="16" />新增{{ archiveKinds[kind] }}</button>
          <div class="buyer-inspection"><button class="btn" :disabled="!directory.buyers.length" @click="emit('inspect-buyers')">一键排查台账购买方</button><p>查看购买方未填写或不在已建公司档案中的发票。</p></div>
        </div>
      </section>
      <section class="finance-card">
        <header class="finance-card-heading"><AppIcon name="link" /><h2>厂家与费用归属</h2></header>
        <div class="finance-card-body">
          <p class="mapping-description">配置厂家对应的购买方和工地，编辑票据时可一键采用；多条匹配需人工选择。</p>
          <label>厂家 / 销售方<input v-model="seller" placeholder="输入厂家全称，与发票销售方一致" /></label>
          <div class="form-grid"><label>购买方<select v-model="buyer"><option value="">选择公司</option><option v-for="value in directory.buyers" :key="value">{{ value }}</option></select></label><label>工地<select v-model="project"><option value="">选择工地</option><option v-for="value in directory.projects" :key="value">{{ value }}</option></select></label></div>
          <button class="btn" @click="rule"><AppIcon name="link" :size="16" />保存对应关系</button>
        </div>
      </section>
    </div>
    <ExpenseSummaryDetails v-if="detailGroup" :group="detailGroup" :sources="detailSources" @close="detailGroup=null" />
    <DirectoryRecordsDialog v-model:open="recordsOpen" v-model:mode="recordsMode" :kinds="archiveKinds" />
    <section class="finance-card">
      <header class="finance-card-heading spread"><h2>费用汇总</h2><label class="inline-check"><input type="checkbox" v-model="bySeller" />按厂家细分</label></header>
      <div class="summary-controls">
        <label>汇总方式<select v-model="groupBy"><option value="both">按工地和费用归属</option><option value="project">按工地</option><option value="allocation">按费用归属</option></select></label>
        <label>工地<select v-model="projectFilter"><option value="">全部工地</option><option v-for="p in projectOptions" :key="p">{{ p }}</option></select></label>
        <label>费用归属<select v-model="allocationFilter"><option value="">全部归属</option><option v-for="a in allocationOptions" :key="a">{{ a }}</option></select></label>
        <button v-if="projectFilter||allocationFilter" class="btn" @click="projectFilter='';allocationFilter=''">清除筛选</button>
        <ExpenseAssignmentImport label="按清单调整归属" />
      </div>
      <div class="finance-table-wrap"><table class="finance-table directory-summary"><thead><tr><th>公司</th><th v-if="groupBy!=='allocation'">工地</th><th v-if="groupBy!=='project'">费用归属</th><th>厂家</th><th class="number-cell">笔数</th><th class="number-cell">采购 / 费用金额</th><th class="number-cell">已报销金额</th><th>明细</th></tr></thead><tbody>
        <tr v-for="record in summary" :key="JSON.stringify([record.buyer,record.project,record.allocation,record.seller])"><td><MiddleEllipsis :text="record.buyer" :tail="6" /></td><td v-if="groupBy!=='allocation'"><MiddleEllipsis :text="record.project" :tail="6" /></td><td v-if="groupBy!=='project'">{{ record.allocation }}</td><td><MiddleEllipsis :text="record.seller" :tail="6" /></td><td class="number-cell">{{ record.count }}</td><td class="number-cell">¥ {{ record.total.toFixed(2) }}</td><td class="number-cell">¥ {{ record.reimbursed.toFixed(2) }}</td><td><button class="text-action" @click="detailGroup=record">查看 / 调整</button></td></tr>
        <tr v-if="!summary.length"><td :colspan="groupBy==='both'?8:7"><div class="finance-empty"><AppIcon name="chart" :size="32" /><strong>暂无符合条件的费用记录</strong><span>请检查所选工地、费用归属或已导入的记录。</span></div></td></tr>
      </tbody></table></div>
    </section>
  </section>
</template>

<style scoped>
.directory-screen{gap:14px}.directory-screen .expense-heading{padding:0;align-items:center}.directory-entry-area{display:flex;flex-direction:column;align-items:flex-end;gap:8px}.directory-entry-buttons{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.directory-screen .directory-layout{align-items:start;gap:16px}.directory-screen .finance-card-heading{padding:12px 16px}.directory-screen .finance-card-body{padding:16px;gap:12px}.directory-screen .finance-card-body label{min-width:0}.directory-screen .form-grid{gap:12px}.directory-screen .finance-card-body input,.directory-screen .finance-card-body select{height:34px;min-width:0;width:100%;padding:5px 9px;font-size:12px}.directory-screen .btn,.directory-screen .btn-primary{min-height:32px;padding:5px 10px}.buyer-inspection{border-top:1px solid #e3e9f0;padding-top:12px}.buyer-inspection p,.mapping-description{font-size:12px;line-height:1.6;color:#64748b;margin:4px 0 0}.mapping-description{margin:0}.directory-summary td{padding:9px 12px}.directory-summary :deep(.middle-ellipsis){width:200px;max-width:200px}
@media(max-width:760px){.directory-screen .expense-heading{align-items:flex-start;gap:12px}.directory-entry-buttons{max-width:310px}.directory-screen .expense-heading h1{white-space:nowrap;font-size:21px}}
.summary-controls { display:flex; align-items:center; flex-wrap:wrap; gap:10px; padding:10px 16px; border-bottom:1px solid #e5eaf0; }
.summary-controls label { display:flex; align-items:center; gap:6px; font-size:12px; color:#51647b; }
.summary-controls select { max-width:15rem; min-height:30px; }
</style>

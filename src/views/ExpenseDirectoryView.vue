<script setup>
import { ref, computed, watch } from 'vue';
import AppIcon from '../components/AppIcon.vue';
import MiddleEllipsis from '../components/MiddleEllipsis.vue';
import DirectoryRecordsDialog from '../components/DirectoryRecordsDialog.vue';
import { directory, saveDirectory } from '../lib/expense-directory';
import { invoiceStore } from '../invoiceStore';
import { paymentStore } from '../lib/payment-store';
import { expenseSummary } from '../lib/expense-summary.js';
import { toast, toastError, toastWarn } from '../lib/toast';

const emit = defineEmits(['inspect-buyers']);
const archiveKinds = { buyers: '购买方公司', projects: '工地', allocations: '费用归属', people: '报销人', purposes: '常用用途', tags: '自定义标签', paymentMethods: '付款方式' };
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
const summary = computed(() => expenseSummary([...Object.values(invoiceStore.ledger), ...paymentStore.rows.filter(row => row.evidenceConfirmed && !row.duplicateOf && !row.linkedLedgerKey)], bySeller.value));

</script>

<template>
  <section class="expense-screen directory-screen">
    <header class="expense-heading">
      <h1>基础档案</h1>
      <div class="directory-entry-area">
        <span class="soft-badge"><AppIcon name="building" :size="16" />{{ directory.buyers.length }} 家公司 · {{ directory.projects.length }} 个工地</span>
        <div class="directory-entry-buttons">
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
    <DirectoryRecordsDialog v-model:open="recordsOpen" v-model:mode="recordsMode" :kinds="archiveKinds" />
    <section class="finance-card">
      <header class="finance-card-heading spread"><h2>费用汇总</h2><label class="inline-check"><input type="checkbox" v-model="bySeller" />按厂家细分</label></header>
      <div class="finance-table-wrap"><table class="finance-table directory-summary"><thead><tr><th>公司</th><th>工地 / 费用归属</th><th>厂家</th><th class="number-cell">笔数</th><th class="number-cell">采购 / 费用金额</th><th class="number-cell">已报销金额</th></tr></thead><tbody>
        <tr v-for="record in summary" :key="JSON.stringify([record.buyer,record.project,record.seller])"><td><MiddleEllipsis :text="record.buyer" :tail="6" /></td><td><MiddleEllipsis :text="record.project" :tail="6" /></td><td><MiddleEllipsis :text="record.seller" :tail="6" /></td><td class="number-cell">{{ record.count }}</td><td class="number-cell">¥ {{ record.total.toFixed(2) }}</td><td class="number-cell">¥ {{ record.reimbursed.toFixed(2) }}</td></tr>
        <tr v-if="!summary.length"><td colspan="6"><div class="finance-empty"><AppIcon name="chart" :size="32" /><strong>暂无费用记录</strong><span>导入历史发票或核对付款凭证后，这里会显示汇总。</span></div></td></tr>
      </tbody></table></div>
    </section>
  </section>
</template>

<style scoped>
.directory-screen{gap:14px}.directory-screen .expense-heading{padding:0;align-items:center}.directory-entry-area{display:flex;flex-direction:column;align-items:flex-end;gap:8px}.directory-entry-buttons{display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.directory-screen .directory-layout{align-items:start;gap:16px}.directory-screen .finance-card-heading{padding:12px 16px}.directory-screen .finance-card-body{padding:16px;gap:12px}.directory-screen .finance-card-body label{min-width:0}.directory-screen .form-grid{gap:12px}.directory-screen .finance-card-body input,.directory-screen .finance-card-body select{height:34px;min-width:0;width:100%;padding:5px 9px;font-size:12px}.directory-screen .btn,.directory-screen .btn-primary{min-height:32px;padding:5px 10px}.buyer-inspection{border-top:1px solid #e3e9f0;padding-top:12px}.buyer-inspection p,.mapping-description{font-size:12px;line-height:1.6;color:#64748b;margin:4px 0 0}.mapping-description{margin:0}.directory-summary td{padding:9px 12px}.directory-summary :deep(.middle-ellipsis){width:200px;max-width:200px}
@media(max-width:760px){.directory-screen .expense-heading{align-items:flex-start;gap:12px}.directory-entry-buttons{max-width:310px}.directory-screen .expense-heading h1{white-space:nowrap;font-size:21px}}
</style>

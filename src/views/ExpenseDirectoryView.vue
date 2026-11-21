<script setup>
import { computed, ref, watch } from 'vue';
import { TabsRoot, TabsList, TabsTrigger, TabsContent } from 'reka-ui';
import ExpenseSummaryDetails from '../components/ExpenseSummaryDetails.vue';
import ExpenseAssignmentImport from '../components/ExpenseAssignmentImport.vue';
import ExpenseArchiveCard from '../components/ExpenseArchiveCard.vue';
import ExpenseAliasCard from '../components/ExpenseAliasCard.vue';
import DirectoryTransfer from '../components/DirectoryTransfer.vue';
import DirectoryRecordsDialog from '../components/DirectoryRecordsDialog.vue';
import MiddleEllipsis from '../components/MiddleEllipsis.vue';
import UiDisclosure from '../components/UiDisclosure.vue';
import ConfirmAction from '../components/ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
import { directory, saveDirectory, deleteArchive, resolveArchiveName } from '../lib/expense-directory.js';
import { invoiceStore } from '../invoiceStore.js';
import { paymentStore, countPaymentExpense } from '../lib/payment-store.js';
import { expenseSummary } from '../lib/expense-summary.js';
import { formatMoney } from '../lib/format.js';
import { toast, toastError, toastWarn } from '../lib/toast.js';
import { archiveKinds } from '../lib/directory-workbook.js';

const emit = defineEmits(['inspect-buyers']);
const tab = ref('summary'), bySeller = ref(false), groupBy = ref('both'), projectFilter = ref(''), allocationFilter = ref('');
const recordsOpen = ref(false), recordsMode = ref('archives');
const seller = ref(''), buyer = ref(''), project = ref('');
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const archiveCount = computed(() => Object.keys(archiveKinds).reduce((count, key) => count + directory[key].length, 0));
const displayKinds = { ...archiveKinds, aliases: '别名' };
const buyerGroup = computed(() => [{ kind: 'buyers', label: '购买方', names: directory.buyers }]);
const siteGroups = computed(() => [
  { kind: 'projects', label: '工地', names: directory.projects },
  { kind: 'allocations', label: '费用归属', names: directory.allocations },
]);
function showRecords(mode) { recordsMode.value = mode; recordsOpen.value = true; }
watch(() => directory.buyers, values => { if (!values.includes(buyer.value)) buyer.value = ''; });
watch(() => directory.projects, values => { if (!values.includes(project.value)) project.value = ''; });

function add(kind, value) {
  if (directory[kind].includes(value)) { toastWarn('该档案已存在'); return; }
  try {
    saveDirectory({ ...directory, [kind]: [...directory[kind], value], deletedArchives: directory.deletedArchives.filter(r => r.kind !== kind || r.value !== value) });
    toast('已新增' + archiveKinds[kind]);
  } catch (error) { toastError('保存失败：' + error.message); }
}
async function remove(kind, value) {
  const count = stats.value[kind]?.get(value)?.count || 0;
  if (!await requestConfirmation('删除' + archiveKinds[kind], '将“' + value + '”移入档案回收站？关联 ' + count + ' 条记录，原记录保留。')) return;
  try { deleteArchive(kind, value); toast('已移入档案回收站。'); }
  catch (error) { toastError('删除失败：' + error.message); }
}
function saveRule() {
  const name = seller.value.trim();
  if (!name || !directory.buyers.includes(buyer.value) || !directory.projects.includes(project.value)) return;
  const next = { seller: name, buyer: buyer.value, project: project.value };
  if (directory.rules.some(item => item.seller === next.seller && item.buyer === next.buyer && item.project === next.project)) {
    toastWarn('该厂家归属已存在'); return;
  }
  try { saveDirectory({ ...directory, rules: [...directory.rules, next] }); toast('厂家归属已保存'); }
  catch (error) { toastError('保存失败：' + error.message); }
}
const sources = computed(() => [
  ...Object.entries(invoiceStore.ledger).map(([key, entry]) => ({ kind: 'invoice', key, entry })),
  ...paymentStore.rows.filter(countPaymentExpense).map(entry => ({ kind: 'payment', key: entry.id, entry })),
]);
const entries = computed(() => sources.value.map(row => row.entry));
const groups = computed(() => expenseSummary(entries.value, false, { groupBy: 'both' }));
function optionsFor(key, configured) {
  return [...new Set([...configured, ...groups.value.map(row => row[key])])].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
const projectOptions = computed(() => optionsFor('project', directory.projects));
const allocationOptions = computed(() => optionsFor('allocation', directory.allocations));
const summaryOptions = computed(() => ({ groupBy: groupBy.value, projectFilter: projectFilter.value, allocationFilter: allocationFilter.value }));
const summary = computed(() => expenseSummary(entries.value, bySeller.value, summaryOptions.value));
const columns = computed(() => [
  ['buyer', '购买方'], ...(groupBy.value !== 'allocation' ? [['project', '工地']] : []),
  ...(groupBy.value !== 'project' ? [['allocation', '费用归属']] : []), ...(bySeller.value ? [['seller', '厂家']] : []),
]);
const detailGroup = ref(null);
const groupKey = record => JSON.stringify([record.buyer, record.project, record.allocation, record.seller]);
const detailSources = computed(() => {
  if (!detailGroup.value) return [];
  const key = groupKey(detailGroup.value);
  return sources.value.flatMap(row => {
    const group = expenseSummary([row.entry], bySeller.value, summaryOptions.value).find(group => groupKey(group) === key);
    return group ? [{ ...row, groupedCents: group.cents, reimbursedCents: group.reimbursedCents }] : [];
  });
});
const stats = computed(() => {
  const buyers = new Map(), projects = new Map(), allocations = new Map();
  const addStats = (map, key, count, cents = 0) => {
    const previous = map.get(key) || { count: 0, cents: 0 };
    const total = previous.cents + cents;
    map.set(key, { count: previous.count + count, cents: total, total: formatMoney(total / 100) });
  };
  for (const entry of Object.values(invoiceStore.ledger)) addStats(buyers, resolveArchiveName('buyers', entry.buyer), 1);
  for (const entry of entries.value) {
    const rows = expenseSummary([entry], false, { groupBy: 'both' });
    const totalsByProject = new Map();
    for (const row of rows) {
      const name = resolveArchiveName('projects', row.project);
      totalsByProject.set(name, (totalsByProject.get(name) || 0) + row.cents);
    }
    for (const [name, cents] of totalsByProject) addStats(projects, name, 1, cents);
    for (const name of new Set(rows.map(row => row.allocation))) addStats(allocations, name, 1);
  }
  return { buyers, projects, allocations };
});
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <DirectoryRecordsDialog v-model:open="recordsOpen" v-model:mode="recordsMode" :kinds="displayKinds" :stats="stats" @add="add" />
    <ExpenseSummaryDetails v-if="detailGroup" :group="detailGroup" :sources="detailSources" @close="detailGroup = null" />
    <template v-else>
      <header class="ui-toolbar min-h-11 flex-wrap justify-between gap-2 py-1">
        <h1 class="text-sm font-semibold">基础档案</h1>
        <div class="flex flex-wrap gap-1.5">
          <DirectoryTransfer compact />
          <button type="button" class="ui-btn" @click="showRecords('archives')">档案清单（{{ archiveCount }}）</button>
          <button type="button" class="ui-btn" @click="showRecords('trash')">回收站（{{ directory.deletedArchives.length }}）</button>
        </div>
      </header>
      <TabsRoot v-model="tab" class="min-w-0">
        <TabsList class="mb-2 flex items-center gap-2 border-b border-line" aria-label="基础档案视图">
          <TabsTrigger value="summary" class="directory-tab">费用汇总分析</TabsTrigger>
          <TabsTrigger value="archives" class="directory-tab">档案与别名维护</TabsTrigger>
        </TabsList>
        <TabsContent value="summary" class="outline-none">
          <section class="ui-panel overflow-hidden" aria-label="费用汇总">
            <header class="ui-section-header flex-wrap">
              <h2 class="text-sm font-semibold">费用汇总清单</h2>
              <ExpenseAssignmentImport label="批量导入归属调整" compact />
            </header>
            <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <select v-model="groupBy" class="ui-input w-40" aria-label="汇总方式">
                <option value="both">工地 + 归属</option><option value="project">仅按工地</option><option value="allocation">仅按归属</option>
              </select>
              <select v-model="projectFilter" class="ui-input w-38" aria-label="筛选工地">
                <option value="">全部工地</option><option v-for="p in projectOptions" :key="p">{{ p }}</option>
              </select>
              <select v-model="allocationFilter" class="ui-input w-38" aria-label="筛选费用归属">
                <option value="">全部归属</option><option v-for="a in allocationOptions" :key="a">{{ a }}</option>
              </select>
              <label class="flex items-center gap-1.5 text-xs"><input v-model="bySeller" type="checkbox" />按厂家细分展开</label>
              <button v-if="projectFilter || allocationFilter" type="button" class="ui-btn-ghost" @click="projectFilter=''; allocationFilter=''">清除筛选</button>
            </div>
            <div class="directory-table-wrap" tabindex="0" aria-label="费用汇总表，可滚动">
              <table class="directory-table">
                <thead><tr><th v-for="[key, label] in columns" :key="key" scope="col">{{ label }}</th><th scope="col" class="text-right">笔数</th><th scope="col" class="text-right">采购 / 费用金额</th><th scope="col" class="text-right">已报销金额</th><th scope="col">明细</th></tr></thead>
                <tbody>
                  <tr v-for="record in summary" :key="groupKey(record)" class="cursor-pointer hover:bg-brand-soft" @click="detailGroup = record">
                    <td v-for="[key] in columns" :key="key"><MiddleEllipsis :text="record[key]" class="max-w-56" /></td>
                    <td class="ui-money text-right">{{ record.count }}</td><td class="ui-money text-right">¥ {{ formatMoney(record.total) }}</td><td class="ui-money text-right">¥ {{ formatMoney(record.reimbursed) }}</td>
                    <td><button type="button" class="ui-btn-ghost h-7 px-1 text-brand" @click.stop="detailGroup = record">查看明细</button></td>
                  </tr>
                  <tr v-if="!summary.length"><td :colspan="columns.length + 4" class="py-10 text-center text-ink-soft">暂无符合条件的费用记录</td></tr>
                </tbody>
              </table>
            </div>
          </section>
        </TabsContent>
        <TabsContent value="archives" class="outline-none">
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ExpenseArchiveCard title="购买方公司" :groups="buyerGroup" :stats="stats" @add="add" @remove="remove">
              <template #actions><button type="button" class="ui-btn-sm" :disabled="!directory.buyers.length" @click="emit('inspect-buyers')">排查台账购买方</button></template>
            </ExpenseArchiveCard>
            <ExpenseArchiveCard title="使用工地与归属" :groups="siteGroups" :stats="stats" @add="add" @remove="remove" />
            <ExpenseAliasCard :stats="stats" />
          </div>
          <UiDisclosure class="ui-panel mt-3 p-3">
            <template #label>厂家归属</template>
            <form class="mt-2 flex flex-wrap items-end gap-2" @submit.prevent="saveRule">
              <label class="ui-label">厂家 / 销售方<input v-model="seller" class="ui-input w-56" required /></label>
              <label class="ui-label">购买方<select v-model="buyer" class="ui-input w-48" required><option value="">选择购买方</option><option v-for="value in directory.buyers" :key="value">{{ value }}</option></select></label>
              <label class="ui-label">工地<select v-model="project" class="ui-input w-48" required><option value="">选择工地</option><option v-for="value in directory.projects" :key="value">{{ value }}</option></select></label>
              <button type="submit" class="ui-btn-primary">保存对应关系</button>
              <button type="button" class="ui-btn" @click="showRecords('rules')">厂家归属清单（{{ directory.rules.length }}）</button>
            </form>
          </UiDisclosure>
        </TabsContent>
      </TabsRoot>
    </template>
  </section>
</template>

<style scoped>
.directory-tab { min-height:32px; padding:0 10px; border-bottom:2px solid transparent; color:#4b5563; }
.directory-tab[data-state=active] { border-color:#1867c0; color:#1867c0; font-weight:600; }
.directory-table-wrap { overflow:auto; max-height:65vh; }
.directory-table { width:100%; border-collapse:separate; border-spacing:0; text-align:left; white-space:nowrap; }
.directory-table th,.directory-table td { border-bottom:1px solid #eef0f3; padding:6px 10px; height:36px; }
.directory-table th { position:sticky; top:0; z-index:1; background:#f9fafb; color:#4b5563; font-weight:600; }
</style>

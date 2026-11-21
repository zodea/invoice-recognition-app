<script setup>
import { computed, ref, watch } from 'vue';
import { directory } from '../lib/expense-directory.js';
import { invoiceActions } from '../invoiceStore.js';
import { allocationKind } from '../lib/payment-records.js';
import { isMultiProject } from '../lib/invoice-allocation.js';
import { formatMoney } from '../lib/format.js';
import InvoiceProjectAllocationDialog from './InvoiceProjectAllocationDialog.vue';
import MiddleEllipsis from './MiddleEllipsis.vue';

const props = defineProps({ sources: Array, group: Object });
const emit = defineEmits(['close']);
const selected = ref(null), allocation = ref(''), project = ref(''), message = ref('');
const query = ref(''), page = ref(1), sourceType = ref('all'), split = ref(null), saved = ref('');
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase();
  return props.sources.filter(({ kind, entry, key }) => (sourceType.value === 'all' || kind === sourceType.value)
    && [key, entry.date, entry.number, entry.seller, entry.total].some(value => String(value ?? '').toLowerCase().includes(term)));
});
const totals = computed(() => filtered.value.reduce((sum, row) => ({
  amount: sum.amount + row.groupedCents, reimbursed: sum.reimbursed + row.reimbursedCents,
}), { amount: 0, reimbursed: 0 }));
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 30)));
const choices = computed(() => [...new Set(['指定工地', '公司开支', '个人报账', '加油', '待确认', ...directory.allocations, allocation.value].filter(Boolean))]);
watch([query, sourceType], () => { page.value = 1; selected.value = null; });
watch(pages, count => { page.value = Math.min(page.value, count); });

function edit(row) {
  selected.value = { ...row, fingerprint: JSON.stringify(row.entry) };
  allocation.value = allocationKind(row.entry);
  project.value = row.entry.project || '';
  message.value = '';
}
function save() {
  const row = selected.value;
  if (!row) return;
  if (allocation.value === '指定工地' && !project.value) { message.value = '请选择工地'; return; }
  try {
    const change = { id: row.key, kind: row.kind, targetKey: row.key, fingerprint: row.fingerprint, canApply: true,
      patch: { allocation: allocation.value, project: allocation.value === '指定工地' ? project.value : '' } };
    invoiceActions.applyAssignmentImport([change], [change.id]);
    selected.value = null;
    saved.value = '已保存该笔记录的工地和费用归属。';
  } catch (error) { message.value = error.message; }
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3" aria-label="费用汇总明细">
    <header class="ui-toolbar min-h-11 flex-wrap gap-2 py-1">
      <button type="button" class="ui-btn" @click="emit('close')">← 返回费用汇总清单</button>
      <div class="min-w-0"><h1 class="text-sm font-semibold">费用明细</h1><p class="truncate text-xs text-ink-secondary">{{ [group.buyer, group.project, group.allocation, group.seller].filter(Boolean).join(' · ') }}</p></div>
    </header>
    <dl class="grid grid-cols-3 gap-2">
      <div class="ui-section"><dt class="text-xs text-ink-secondary">记录</dt><dd class="ui-money text-base font-semibold">{{ filtered.length }} 笔</dd></div>
      <div class="ui-section"><dt class="text-xs text-ink-secondary">采购 / 费用金额</dt><dd class="ui-money text-base font-semibold">¥{{ formatMoney(totals.amount / 100) }}</dd></div>
      <div class="ui-section"><dt class="text-xs text-ink-secondary">已报销金额</dt><dd class="ui-money text-base font-semibold">¥{{ formatMoney(totals.reimbursed / 100) }}</dd></div>
    </dl>
    <div class="ui-panel overflow-hidden">
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2" role="group" aria-label="筛选费用明细">
        <button v-for="[value, label] in [['all', '全部'], ['invoice', '仅发票'], ['payment', '仅垫资']]" :key="value" type="button" class="ui-btn"
          :class="{ 'bg-brand-soft text-brand-deep': sourceType === value }" :aria-pressed="sourceType === value" @click="sourceType = value">{{ label }}</button>
        <input v-model="query" class="ui-input w-60" placeholder="搜索票号、日期、厂家或金额" aria-label="搜索费用明细" type="search" />
      </div>
      <p v-if="saved" class="px-3 py-2 text-xs text-ok" role="status">{{ saved }}</p>
      <div class="max-h-[58vh] overflow-auto" tabindex="0" aria-label="费用明细表，可滚动">
        <table class="summary-detail-table w-full min-w-[820px] whitespace-nowrap text-left">
          <thead><tr><th>来源</th><th>日期</th><th>厂家 / 收款方</th><th>票号 / 标识</th><th>归属</th><th class="text-right">本组金额</th><th>操作</th></tr></thead>
          <tbody>
            <template v-for="row in filtered.slice((page - 1) * 30, page * 30)" :key="row.kind + ':' + row.key">
              <tr>
                <td><span :class="row.kind === 'invoice' ? 'ui-badge-brand' : 'ui-badge-neutral'">{{ row.kind === 'invoice' ? '发票' : '垫资' }}</span></td>
                <td class="ui-money">{{ row.entry.date || '—' }}</td>
                <td><MiddleEllipsis :text="row.entry.seller || '—'" class="max-w-50" /></td>
                <td><MiddleEllipsis :text="row.entry.number || row.key" class="max-w-46 ui-money" /></td>
                <td>{{ isMultiProject(row.entry) ? '多工地分配' : row.entry.project || allocationKind(row.entry) }}</td>
                <td class="ui-money text-right">¥{{ formatMoney(row.groupedCents / 100) }}</td>
                <td>
                  <button v-if="isMultiProject(row.entry) && row.kind === 'invoice'" class="ui-btn-sm" @click="split = { ...row.entry, key: row.key }">调整分摊</button>
                  <button v-else-if="!isMultiProject(row.entry)" class="ui-btn-sm" @click="edit(row)">调整归属</button>
                </td>
              </tr>
              <tr v-if="selected?.key === row.key && selected?.kind === row.kind">
                <td colspan="7" class="bg-brand-soft">
                  <form class="flex flex-wrap items-center gap-2 py-1" @submit.prevent="save">
                    <label class="flex items-center gap-1.5 text-xs">费用归属<select v-model="allocation" class="ui-input w-36"><option v-for="value in choices" :key="value">{{ value }}</option></select></label>
                    <label v-if="allocation === '指定工地'" class="flex items-center gap-1.5 text-xs">工地<select v-model="project" class="ui-input w-42" required><option value="">选择工地</option><option v-for="value in directory.projects" :key="value">{{ value }}</option></select></label>
                    <button class="ui-btn-primary" type="submit">保存这笔归属</button><button class="ui-btn" type="button" @click="selected = null">取消</button>
                    <span v-if="message" class="text-xs text-danger" role="alert">{{ message }}</span>
                  </form>
                </td>
              </tr>
            </template>
            <tr v-if="!filtered.length"><td colspan="7" class="py-10 text-center text-ink-soft">暂无符合条件的费用明细</td></tr>
          </tbody>
        </table>
      </div>
      <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-3 py-1.5 text-xs">
        <span class="mr-auto">共 {{ filtered.length }} 笔</span><button class="ui-btn" :disabled="page <= 1" @click="page--">上一页</button><span class="ui-money">{{ page }} / {{ pages }}</span><button class="ui-btn" :disabled="page >= pages" @click="page++">下一页</button>
      </footer>
    </div>
    <InvoiceProjectAllocationDialog v-if="split" :entry="split" @close="split = null" />
  </section>
</template>

<style scoped>
.summary-detail-table { border-collapse:separate; border-spacing:0; }
.summary-detail-table th,.summary-detail-table td { border-bottom:1px solid #eef0f3; padding:6px 10px; height:36px; }
.summary-detail-table th { position:sticky; top:0; z-index:1; background:#f9fafb; color:#4b5563; font-weight:600; }
</style>

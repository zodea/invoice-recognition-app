<script setup>
import { computed } from 'vue';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import InvoiceBuyerCheck from './InvoiceBuyerCheck.vue';

const props = defineProps({ presets: Array, counts: Object, projects: Array, buyers: Array, buyerCounts: Object, buyersConfigured: Boolean, hasFilters: Boolean });
const filters = defineModel({ type: Object, required: true });
const emit = defineEmits(['reset', 'scan']);
const dateShortcuts = [
  { label: '本月', months: 1, offset: 0 },
  { label: '本季度', months: 3, offset: 0 },
  { label: '上季度', months: 3, offset: -3 },
];
const currentPreset = computed(() => props.presets.find(({ key }) => key === filters.value.preset)?.key || 'all');
function dateText(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function chooseDates({ months, offset }) {
  const now = new Date();
  const month = Math.floor(now.getMonth() / months) * months + offset;
  filters.value.startDate = dateText(new Date(now.getFullYear(), month, 1));
  filters.value.endDate = dateText(new Date(now.getFullYear(), month + months, 0));
}
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-1.5 px-3 pt-2" role="group" aria-label="快捷筛选">
    <button v-for="{ key, label } in presets" :key="key" type="button" class="ui-btn !rounded-full"
      :class="{ 'border-brand/25 bg-brand-soft text-brand-deep': currentPreset === key }"
      :aria-pressed="currentPreset === key" @click="filters.preset = key">
      {{ label }} <span class="ui-money text-xs">{{ counts[key] }}</span>
    </button>
  </div>
  <div class="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2" aria-label="台账筛选">
    <input v-model="filters.query" type="search" class="ui-input w-62 max-w-full" aria-label="搜索台账" placeholder="销售方、票号、费用名或备注" />
    <select v-model="filters.project" class="ui-input w-39 max-w-full" aria-label="使用工地">
      <option value="">全部工地</option><option v-for="value in projects" :key="value">{{ value }}</option>
    </select>
    <select v-model="filters.buyer" class="ui-input w-39 max-w-full" aria-label="购买方">
      <option value="">全部购买方</option><option v-for="value in buyers" :key="value">{{ value }}</option>
    </select>
    <PopoverRoot>
      <PopoverTrigger class="ui-btn">更多筛选</PopoverTrigger>
      <PopoverPortal>
        <PopoverContent class="ui-popover z-45 w-[min(450px,94vw)] max-h-[min(75vh,530px)] overflow-auto" align="start" :side-offset="6">
          <div class="flex flex-col gap-3">
            <div class="flex flex-wrap gap-1.5">
              <button v-for="item in dateShortcuts" :key="item.label" type="button" class="ui-btn-sm" @click="chooseDates(item)">{{ item.label }}</button>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <label class="ui-label">开票日期从<input v-model="filters.startDate" class="ui-input" type="date" /></label>
              <label class="ui-label">开票日期至<input v-model="filters.endDate" class="ui-input" type="date" :min="filters.startDate || undefined" /></label>
              <label class="ui-label">最小金额<input v-model="filters.min" class="ui-input ui-money" type="number" step=".01" /></label>
              <label class="ui-label">最大金额<input v-model="filters.max" class="ui-input ui-money" type="number" step=".01" /></label>
              <label class="ui-label">精确金额<input v-model="filters.amountQuery" class="ui-input ui-money" inputmode="decimal" aria-label="按金额查询发票" /></label>
              <label class="ui-label">查询金额口径<select v-model="filters.amountField" class="ui-input"><option value="total">价税合计</option><option value="amount">不含税金额</option><option value="tax">税额</option></select></label>
              <label class="ui-label">抵税状态<select v-model="filters.selection" class="ui-input"><option value="all">全部</option><option value="selected">已抵税</option><option value="unselected">未勾选</option><option value="unknown">未知</option></select></label>
              <label class="ui-label">报销核对<select v-model="filters.reimbursement" class="ui-input"><option value="all">全部</option><option>未核对</option><option>已报销</option><option>未报销</option></select></label>
              <label class="ui-label">红字状态<select v-model="filters.red" class="ui-input"><option value="all">全部</option><option value="red">红字 / 冲红</option><option value="normal">无红字标记</option></select></label>
              <label class="ui-label">原件<select v-model="filters.attachment" class="ui-input"><option value="all">全部</option><option value="yes">已关联</option><option value="no">未关联</option></select></label>
            </div>
            <InvoiceBuyerCheck compact v-model="filters.buyerCheck" :configured="buyersConfigured" :counts="buyerCounts" @scan="emit('scan')" />
            <label class="flex items-center gap-2 text-xs"><input v-model="filters.supplementOnly" type="checkbox" aria-label="仅看有附件" />仅看补充附件</label>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
    <button v-if="hasFilters" type="button" class="ui-btn-ghost" @click="emit('reset')">重置全部条件</button>
    <slot />
  </div>
</template>

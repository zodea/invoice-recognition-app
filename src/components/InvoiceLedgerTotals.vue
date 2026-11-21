<script setup>
import { computed } from 'vue';
import { formatMoney } from '../lib/format.js';
import { toChineseUpper } from '../lib/chinese-money.js';

const props = defineProps({ totals: Object, count: Number, project: String, projectTotal: Number });
const items = computed(() => [
  { name: '不含税金额', value: props.totals.amount, count: props.totals.amountCount },
  { name: '税额', value: props.totals.tax, count: props.totals.taxCount },
  { name: props.project ? '整票价税合计' : '价税合计', value: props.totals.total, count: props.totals.totalCount },
  { name: '有效抵扣税额', value: props.totals.validTax, count: props.totals.validTaxCount },
]);
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <dl class="grid grid-cols-2 lg:grid-cols-4 gap-2 px-3 pb-2" aria-label="筛选结果金额汇总">
      <div v-for="item in items" :key="item.name" class="min-w-0 rounded-md border border-line bg-surface px-2.5 py-1.5">
        <dt class="truncate text-[11.5px] text-ink-soft">{{ item.name }}</dt>
        <dd class="flex items-baseline gap-2">
          <TooltipRoot v-if="item.count">
            <TooltipTrigger as="span" tabindex="0" class="ui-focus ui-money min-w-0 truncate text-base font-semibold">{{ formatMoney(item.value) }}</TooltipTrigger>
            <TooltipPortal><TooltipContent class="z-100 max-w-[90vw] rounded-md bg-ink px-2 py-1 text-xs text-white" :side-offset="6">{{ toChineseUpper(item.value) }}</TooltipContent></TooltipPortal>
          </TooltipRoot>
          <span v-else class="text-base text-ink-soft">—</span>
          <small v-if="count && item.count !== count" class="whitespace-nowrap text-warn">{{ count - item.count }} 张缺失</small>
        </dd>
      </div>
    </dl>
  </TooltipProvider>
  <p v-if="project" class="px-3 pb-2 text-xs text-ink-secondary">{{ project }}分配金额 <strong class="ui-money">{{ formatMoney(projectTotal) }}</strong></p>
</template>

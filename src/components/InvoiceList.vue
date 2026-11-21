<script setup>
import { computed, nextTick, ref, watch, useTemplateRef } from 'vue';
import { selectInvoice } from '../invoiceStore.js';
import { useConfirmation } from '../composables/useConfirmation.js';

const props = defineProps({ items: { type: Array, required: true }, activeId: String, counts: Object });
const filter = defineModel('filter', { type: String, required: true });
const emit = defineEmits(['select-all', 'select-none', 'invert']);
const segments = [['all', '全部'], ['pending', '待核'], ['issue', '异常']];
const rows = useTemplateRef('rows');
const pageSize = 20;
const ConfirmAction = defineAsyncComponent(() => import('./ConfirmAction.vue'));
const page = ref(0);
const pageCount = computed(() => Math.max(1, Math.ceil(props.items.length / pageSize)));
const visibleItems = computed(() => props.items.slice(page.value * pageSize, (page.value + 1) * pageSize));
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();

watch(pageCount, count => { page.value = Math.min(page.value, count - 1); });
watch(page, () => rows.value?.scrollTo({ top: 0 }), { flush: 'post' });
watch(() => props.activeId, async id => {
  const index = props.items.findIndex(item => item.inv.id === id);
  if (index < 0) return;
  page.value = Math.floor(index / pageSize);
  await nextTick();
  rows.value?.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}, { flush: 'post' });

async function setIncluded(invoice, event) {
  const checked = event.target.checked;
  event.target.checked = invoice.include;
  if (checked && invoice.history?.entry?.reimbursement === '已报销' && !await requestConfirmation('可能重复报销', '这张发票已报销。仍要加入打印和汇总吗？', '加入')) return;
  invoice.include = checked;
  invoice.includeTouched = true;
}
</script>

<template>
  <aside class="work-panel invoice-list flex flex-col" aria-label="票据列表">
    <div class="ui-section-header bg-surface"><h2 class="text-sm font-semibold">票据列表</h2><span class="text-xs text-ink-soft">{{ items.length }} 张</span></div>
    <div class="ui-segmented mx-2 mt-2" role="group" aria-label="票据状态筛选">
      <button v-for="[value, label] in segments" :key="value" type="button" class="ui-btn-sm px-1" :class="{ 'bg-brand-soft text-brand-deep': filter === value }" :aria-pressed="filter === value" @click="filter = value">{{ label }} <b class="ui-money">{{ counts[value] || 0 }}</b></button>
    </div>
    <div class="invoice-list-actions"><button type="button" @click="emit('select-all')">全选</button><button type="button" @click="emit('invert')">反选</button><button type="button" @click="emit('select-none')">全不选</button></div>
    <div ref="rows" class="min-h-0 flex-1 overflow-auto">
      <TransitionGroup name="invoice-row" :css="pageCount === 1">
        <div key="empty" v-if="!items.length" class="work-empty">没有符合条件的票据</div>
        <div v-for="{ inv, status } in visibleItems" :key="inv.id" class="invoice-list-row" :class="{ selected: activeId === inv.id }" :data-inv-list="inv.id">
          <input class="self-start mt-0.5" type="checkbox" :checked="inv.include" :aria-label="`选择 ${inv.name} 用于打印`" @change="setIncluded(inv, $event)" />
          <button class="invoice-list-select ui-focus" type="button" :aria-pressed="activeId === inv.id" @click="selectInvoice(inv.id)">
            <span class="invoice-list-top w-full"><strong><MiddleEllipsis :text="inv.fields.seller || inv.name" :tail="inv.fields.seller ? 5 : 12" /></strong><b class="ui-money">{{ inv.fields.total === '' || inv.fields.total == null ? '—' : `¥${inv.fields.total}` }}</b></span>
            <span class="invoice-list-meta w-full"><span class="shrink-0">{{ inv.fields.date || '日期待核对' }}</span><span class="truncate">{{ inv.fields.type || inv.fields.docType || '票种待识别' }}</span></span>
            <span class="flex min-w-0 w-full items-center gap-2"><WorkspaceStatus class="shrink-0" :status="status" /><MiddleEllipsis v-if="inv.fields.seller" class="min-w-0 text-xs text-ink-soft" :text="inv.name" :tail="12" /></span>
          </button>
        </div>
      </TransitionGroup>
    </div>
    <nav v-if="pageCount > 1" class="invoice-list-actions" aria-label="票据列表分页">
      <button type="button" :disabled="page === 0" @click="page--">上一页</button>
      <span aria-live="polite">{{ page + 1 }} / {{ pageCount }}</span>
      <button type="button" :disabled="page + 1 >= pageCount" @click="page++">下一页</button>
    </nav>
    <ConfirmAction v-if="confirmation" :request="confirmation" @answer="answerConfirmation" />
  </aside>
</template>

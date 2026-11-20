<script setup>
import { watch, useTemplateRef } from 'vue';
import { selectInvoice } from '../invoiceStore.js';
import { useConfirmation } from '../composables/useConfirmation.js';
import ConfirmAction from './ConfirmAction.vue';
import WorkspaceStatus from './WorkspaceStatus.vue';

const props = defineProps({ items: { type: Array, required: true }, activeId: String, counts: Object });
const filter = defineModel('filter', { type: String, required: true });
const emit = defineEmits(['select-all', 'select-none', 'invert']);
const segments = [['all', '全部'], ['pending', '待核'], ['issue', '异常']];
const rows = useTemplateRef('rows');
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();

watch(() => props.activeId, () => {
  rows.value?.querySelector('[aria-pressed=true]')?.scrollIntoView({ block: 'nearest' });
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
      <div v-if="!items.length" class="work-empty">没有符合条件的票据</div>
      <div v-for="{ inv, status } in items" :key="inv.id" class="invoice-list-row" :class="{ selected: activeId === inv.id }" :data-inv-list="inv.id">
        <input class="self-start mt-0.5" type="checkbox" :checked="inv.include" :aria-label="`选择 ${inv.name} 用于打印`" @change="setIncluded(inv, $event)" />
        <button class="invoice-list-select ui-focus" type="button" :aria-pressed="activeId === inv.id" @click="selectInvoice(inv.id)">
          <span class="invoice-list-top w-full"><strong :title="inv.fields.seller || inv.name">{{ inv.fields.seller || inv.name }}</strong><b class="ui-money">{{ inv.fields.total === '' || inv.fields.total == null ? '—' : `¥${inv.fields.total}` }}</b></span>
          <span class="invoice-list-meta w-full"><span class="shrink-0">{{ inv.fields.date || '日期待核对' }}</span><span class="truncate">{{ inv.fields.type || inv.fields.docType || '票种待识别' }}</span></span>
          <WorkspaceStatus class="self-start" :status="status" />
        </button>
      </div>
    </div>
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
  </aside>
</template>

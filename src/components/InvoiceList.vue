<script setup>
import { selectInvoice } from "../invoiceStore";
import MiddleEllipsis from "./MiddleEllipsis.vue";

defineProps({ items: { type: Array, required: true }, activeId: String });
const emit = defineEmits(["select-all", "select-none", "invert"]);

function setIncluded(inv, checked) {
  if (checked && inv.history?.entry?.reimbursement === "已报销" && !window.confirm(`这张发票已报销${inv.history.entry.reimbursementDate ? `（${inv.history.entry.reimbursementDate}）` : ""}，可能重复报销。仍要加入打印和汇总吗？`)) return;
  inv.include = checked;
  inv.includeTouched = true;
}
</script>

<template>
  <aside class="work-panel invoice-list" aria-label="发票列表">
    <div class="panel-heading"><div><h2>发票列表 <span>（{{ items.length }}）</span></h2><p>勾选用于打印和导出</p></div></div>
    <div class="invoice-list-actions"><button type="button" @click="emit('select-all')">全选</button><button type="button" @click="emit('invert')">反选</button><button type="button" @click="emit('select-none')">全不选</button></div>
    <div v-if="!items.length" class="work-empty">没有符合条件的发票</div>
    <div v-for="item in items" :key="item.inv.id" class="invoice-list-row" :class="{ selected: activeId === item.inv.id }" :data-inv-list="item.inv.id">
      <input type="checkbox" :checked="item.inv.include" :aria-label="`选择 ${item.inv.name} 用于打印`" @change="setIncluded(item.inv, $event.target.checked)" />
      <button class="invoice-list-select" type="button" :aria-pressed="activeId === item.inv.id" @click="selectInvoice(item.inv.id)">
        <span class="invoice-list-top"><strong>{{ item.inv.fields.type || item.inv.fields.docType || '发票' }}</strong><span class="invoice-status" :class="{ done: item.inv.history?.entry?.reimbursement === '已报销', warn: item.needsReview }">{{ item.inv.history?.entry?.reimbursement === '已报销' ? '已报销' : item.needsReview ? '待核对' : item.inv.history?.entry?.reimbursement || '未核对' }}</span></span>
        <span class="invoice-list-name"><MiddleEllipsis :text="item.inv.fields.seller || item.inv.name" /></span>
        <span class="invoice-list-meta"><span>{{ item.inv.fields.date || '日期待核对' }}</span><b>{{ item.inv.fields.total ? `¥${item.inv.fields.total}` : '金额待核对' }}</b></span>
        <span v-if="item.inv.duplicateReason" class="invoice-list-warning">重复发票</span>
      </button>
    </div>
  </aside>
</template>

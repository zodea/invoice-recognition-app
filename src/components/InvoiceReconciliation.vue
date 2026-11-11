<script setup>
import SearchSelect from "./SearchSelect.vue";
import SearchTags from "./SearchTags.vue";
import { useExpenseOptions } from "../composables/useExpenseOptions";
const expenseChoices = useExpenseOptions();
import { computed, ref } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { invoiceActions, invoiceStore } from "../invoiceStore";
import { deductionStatus, historyStatus, missingReimbursementFields } from "../lib/invoice-ledger";
import InvoiceReimbursementBatch from "./InvoiceReimbursementBatch.vue";

defineProps({ open: Boolean });
const emit = defineEmits(["update:open"]);
const query = ref("");
const filter = ref("all");
const page = ref(1);
const message = ref("");
const selectedKeys = ref([]);
const currentKeys = computed(() => new Set(invoiceStore.invoices.filter(i => i.status === "done").map(i => historyStatus(invoiceStore.ledger, i).entry?.key).filter(Boolean)));
const entries = computed(() => Object.values(invoiceStore.ledger).filter(e => {
  const match = currentKeys.value.has(e.key);
  const reimbursed = e.reimbursement === "已报销";
  if (filter.value === "current" && !match) return false;
  if (filter.value === "matched" && !(match && reimbursed)) return false;
  if (filter.value === "reimbursed" && !reimbursed) return false;
  if (filter.value === "unknown" && (e.reimbursement || "未核对") !== "未核对") return false;
  return `${e.number || ""} ${e.seller || ""} ${e.reimburser || ""} ${e.project || ""} ${e.purpose || ""} ${e.tags || ""}`.includes(query.value.trim());
}));
const pages = computed(() => Math.max(1, Math.ceil(entries.value.length / 20)));
const shown = computed(() => entries.value.slice((Math.min(page.value, pages.value) - 1) * 20, Math.min(page.value, pages.value) * 20));
function update(e, key, event) {
  try {
    const result = invoiceActions.updateReconciliation(e.key, { [key]: event.target.value });
    if (!result.ok) { message.value = result.message; event.target.value = e[key] || (key === "reimbursement" ? "未核对" : ""); }
    else message.value = "";
  } catch (err) { message.value = `保存失败：${err.message || err}`; }
}
function markBatch(date) {
  try {
    const result = invoiceActions.markReimbursedBatch(selectedKeys.value, date);
    message.value = `已标记 ${result.marked} 条；跳过已报销 ${result.already} 条${result.missing ? `，找不到 ${result.missing} 条` : ""}。`;
    selectedKeys.value = [];
  } catch (err) { message.value = `保存失败：${err.message || err}`; }
}
</script>
<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(1350px,96vw)] max-h-[90vh] flex flex-col bg-panel rounded-card shadow-pop border border-line overflow-hidden outline-none">
        <div class="flex justify-between items-center p-4 border-b border-line"><DialogTitle class="font-700">历史发票报销核对</DialogTitle><DialogClose class="btn">关闭</DialogClose></div>
        <div class="p-3 text-xs text-ink-soft">抵税和报销分别记录。批量标记时请选择实际报销日期，资料不完整的记录可之后补充。</div>
        <div class="flex gap-2 p-3 border-b border-line"><input v-model="query" class="field-input" placeholder="搜索号码、销售方、报销人、工地或用途" @input="page = 1" /><select v-model="filter" class="field-input" @change="page = 1"><option value="all">全部</option><option value="current">当前发票匹配的台账</option><option value="matched">当前发票中已报销的重合项</option><option value="reimbursed">已报销</option><option value="unknown">未核对</option></select><span class="text-xs">共 {{ entries.length }} 条</span></div>
        <InvoiceReimbursementBatch :selected-count="selectedKeys.length" :visible-count="entries.length" @select-filtered="selectedKeys = entries.map(e => e.key)" @clear="selectedKeys = []" @mark="markBatch" />
        <div v-if="message" class="p-2 text-xs text-[#92400e] bg-[#fffbeb]" role="status">{{ message }}</div>
        <div class="overflow-auto"><table class="w-full text-xs"><thead><tr><th>选择</th><th>发票号码 / 日期</th><th>销售方 / 金额</th><th>抵税</th><th>报销状态</th><th>报销人</th><th>工地</th><th>用途</th><th>付款方式</th><th>自定义标签</th><th>当前匹配</th></tr></thead><tbody><tr v-for="e in shown" :key="e.key" class="border-t border-line"><td><input v-model="selectedKeys" type="checkbox" :value="e.key" :aria-label="`选择发票 ${e.number}`" /></td><td class="p-2">{{ e.number }}<br>{{ e.date }}</td><td class="p-2">{{ e.seller || '—' }}<br>{{ e.total === '' ? '—' : e.total }}</td><td class="p-2">{{ deductionStatus(e) }}</td><td class="p-2"><select class="field-input" :value="e.reimbursement || '未核对'" @change="update(e, 'reimbursement', $event)"><option>未核对</option><option>已报销</option><option>未报销</option></select><input class="field-input" type="date" :value="e.reimbursementDate || ''" aria-label="报销日期" @change="update(e, 'reimbursementDate', $event)" /><div v-if="e.reimbursement === '已报销' && missingReimbursementFields(e).length" class="text-[#b45309]">缺少 {{ missingReimbursementFields(e).join('、') }}</div><div v-if="(e.batches || []).some(b => b.type !== '打印')">有历史批次，需核对</div></td><td><SearchSelect :model-value="e.reimburser || ''" :options="expenseChoices.reimburser" label="报销人"  @update:model-value="update(e, 'reimburser', {target:{value:$event}})" /></td><td><SearchSelect :model-value="e.project || ''" :options="expenseChoices.project" label="工地"  @update:model-value="update(e, 'project', {target:{value:$event}})" /></td><td><SearchSelect :model-value="e.purpose || ''" :options="expenseChoices.purpose" label="用途" allow-custom @update:model-value="update(e, 'purpose', {target:{value:$event}})" /></td><td><SearchSelect :model-value="e.payment || ''" :options="expenseChoices.payment" label="付款方式"  @update:model-value="update(e, 'payment', {target:{value:$event}})" /></td><td><SearchTags :model-value="e.tags || ''" :options="expenseChoices.tags" @update:model-value="update(e, 'tags', {target:{value:$event}})" /></td><td class="p-2">{{ currentKeys.has(e.key) ? '匹配' : '—' }}</td></tr></tbody></table></div>
        <div class="flex gap-3 p-3 border-t border-line"><button class="btn" :disabled="page <= 1" @click="page--">上一页</button><span>{{ Math.min(page, pages) }} / {{ pages }}</span><button class="btn" :disabled="page >= pages" @click="page++">下一页</button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

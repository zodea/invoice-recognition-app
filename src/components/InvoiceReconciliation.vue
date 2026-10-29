<script setup>
import { computed, ref } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { invoiceActions, invoiceStore } from "../invoiceStore";
import { deductionStatus, ledgerKey, missingReimbursementFields } from "../lib/invoice-ledger";

defineProps({ open: Boolean });
const emit = defineEmits(["update:open"]);
const query = ref("");
const filter = ref("all");
const page = ref(1);
const message = ref("");
const currentKeys = computed(() => new Set(invoiceStore.invoices.filter(i => i.status === "done").map(ledgerKey)));
const entries = computed(() => Object.values(invoiceStore.ledger).filter(e => {
  const match = currentKeys.value.has(e.key);
  const reimbursed = e.reimbursement === "已报销";
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
</script>
<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(1350px,96vw)] max-h-[90vh] flex flex-col bg-panel rounded-card shadow-pop border border-line overflow-hidden outline-none">
        <div class="flex justify-between items-center p-4 border-b border-line"><DialogTitle class="font-700">历史发票报销核对</DialogTitle><DialogClose class="btn">关闭</DialogClose></div>
        <div class="p-3 text-xs text-ink-soft">抵税和个人报销分别记录。标记已报销前请填写报销人、工地和用途；旧记录资料不完整时会提示补充。</div>
        <div class="flex gap-2 p-3 border-b border-line"><input v-model="query" class="field-input" placeholder="搜索号码、销售方、报销人、工地或用途" @input="page = 1" /><select v-model="filter" class="field-input" @change="page = 1"><option value="all">全部</option><option value="matched">当前发票中已报销的重合项</option><option value="reimbursed">已报销</option><option value="unknown">未核对</option></select><span class="text-xs">共 {{ entries.length }} 条</span></div>
        <div v-if="message" class="p-2 text-xs text-[#92400e] bg-[#fffbeb]" role="status">{{ message }}</div>
        <div class="overflow-auto"><table class="w-full text-xs"><thead><tr><th>发票号码 / 日期</th><th>销售方 / 金额</th><th>抵税</th><th>报销状态</th><th>报销人</th><th>工地</th><th>用途</th><th>支付方式</th><th>标签</th><th>当前匹配</th></tr></thead><tbody><tr v-for="e in shown" :key="e.key" class="border-t border-line"><td class="p-2">{{ e.number }}<br>{{ e.date }}</td><td class="p-2">{{ e.seller || '—' }}<br>{{ e.total === '' ? '—' : e.total }}</td><td class="p-2">{{ deductionStatus(e) }}</td><td class="p-2"><select class="field-input" :value="e.reimbursement || '未核对'" @change="update(e, 'reimbursement', $event)"><option>未核对</option><option>已报销</option><option>未报销</option></select><div v-if="e.reimbursement === '已报销' && missingReimbursementFields(e).length" class="text-[#b45309]">缺少 {{ missingReimbursementFields(e).join('、') }}</div><div v-if="(e.batches || []).some(b => b.type !== '打印')">有历史批次，需核对</div></td><td><input class="field-input w-28" :value="e.reimburser || ''" placeholder="报销人" @change="update(e, 'reimburser', $event)" /></td><td><input class="field-input w-32" :value="e.project || ''" placeholder="工地" @change="update(e, 'project', $event)" /></td><td><input class="field-input w-32" :value="e.purpose || ''" placeholder="用途" @change="update(e, 'purpose', $event)" /></td><td><input class="field-input w-28" :value="e.payment || ''" list="payment-options" placeholder="支付方式" @change="update(e, 'payment', $event)" /></td><td><input class="field-input w-32" :value="e.tags || ''" placeholder="自定义标签" @change="update(e, 'tags', $event)" /></td><td class="p-2">{{ currentKeys.has(e.key) ? '匹配' : '—' }}</td></tr></tbody></table><datalist id="payment-options"><option value="个人报销"/><option value="公账支付"/><option value="其他"/></datalist></div>
        <div class="flex gap-3 p-3 border-t border-line"><button class="btn" :disabled="page <= 1" @click="page--">上一页</button><span>{{ Math.min(page, pages) }} / {{ pages }}</span><button class="btn" :disabled="page >= pages" @click="page++">下一页</button></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

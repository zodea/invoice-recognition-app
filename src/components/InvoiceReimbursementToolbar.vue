<script setup>
import { ref } from "vue";
import { EXPENSE_TAGS } from "../lib/invoice-tags";
defineProps({ selectedCount: Number, visibleCount: Number, status: String, tag: String });
const emit = defineEmits(["select-all", "clear", "mark", "cancel", "update:status", "update:tag"]);
const date = ref("");
const dateMessage = ref("");
function markSelected() {
  if (!date.value) {
    dateMessage.value = "请先选择实际报销日期，再点击标记已报销。";
    return;
  }
  dateMessage.value = "";
  emit("mark", date.value);
}
</script>
<template>
  <div class="reimbursement-toolbar" aria-label="报销筛选和批量操作">
    <div class="reimbursement-filters"><label>报销状态<select class="field-input" :value="status" @change="emit('update:status', $event.target.value)"><option value="all">全部</option><option value="reimbursed">已报销</option><option value="unreimbursed">未报销 / 未核对</option></select></label><label>费用标签<select class="field-input" :value="tag" @change="emit('update:tag', $event.target.value)"><option value="all">全部</option><option value="">未分类</option><option v-for="item in EXPENSE_TAGS" :key="item" :value="item">{{ item }}</option></select></label></div>
    <details class="reimbursement-batch"><summary>批量报销 <span>已选择 {{ selectedCount }} 张</span></summary><div class="reimbursement-batch-body"><div class="reimbursement-selection"><button class="btn" :disabled="!visibleCount" @click="emit('select-all')">选择当前筛选（{{ visibleCount }}）</button><button class="btn" :disabled="!selectedCount" @click="emit('clear')">清空报销选择</button><span>报销选择与打印勾选分别操作。</span></div><div class="reimbursement-actions"><label>报销日期（必填）<input v-model="date" class="field-input" type="date" @change="dateMessage = ''" /></label><button class="btn-primary" :disabled="!selectedCount" @click="markSelected">批量标记已报销</button><button class="btn" :disabled="!selectedCount" @click="emit('cancel')">取消已报销标记</button></div><span v-if="dateMessage" class="reimbursement-warning" role="alert">{{ dateMessage }}</span><span v-else-if="selectedCount && !date" class="reimbursement-hint" role="status">请先选择实际报销日期。</span></div></details>
  </div>
</template>

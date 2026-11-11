<script setup>
import { ref } from "vue";
const props = defineProps({ selectedCount: Number, visibleCount: Number });
const emit = defineEmits(["select-filtered", "clear", "mark"]);
const date = ref("");
function mark() {
  if (!date.value || !props.selectedCount) return;
  if (window.confirm(`将选中的 ${props.selectedCount} 条记录标记为已报销，报销日期为 ${date.value}。已报销的记录会跳过，确认吗？`)) emit("mark", date.value);
}
</script>
<template>
  <div class="flex gap-2 p-3 flex-wrap items-center border-b border-line text-xs">
    <button class="btn" :disabled="!visibleCount" @click="emit('select-filtered')">选择筛选结果（{{ visibleCount }} 条）</button>
    <button class="btn" :disabled="!selectedCount" @click="emit('clear')">清空选择</button>
    <span>已选 {{ selectedCount }} 条</span>
    <label>报销日期 <input v-model="date" class="field-input" type="date" /></label>
    <button class="btn-primary" :disabled="!selectedCount || !date" @click="mark">批量标记已报销</button>
  </div>
</template>

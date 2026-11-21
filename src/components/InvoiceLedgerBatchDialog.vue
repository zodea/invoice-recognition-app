<script setup>
import { computed, ref } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { directory } from '../lib/expense-directory.js';
import { isMultiProject, withProjectAllocation } from '../lib/invoice-allocation.js';

const props = defineProps({ action: String, entries: Array });
const emit = defineEmits(['close', 'saved']);
const changingProject = computed(() => props.action === 'project');
const project = ref('');
const today = new Date();
const date = ref([today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-'));
const message = ref('');
const eligible = computed(() => props.entries.filter(entry => !isMultiProject(entry)));
function submit() {
  message.value = '';
  try {
    if (changingProject.value) {
      const review = eligible.value.map(entry => {
        const { allocation, projectAllocations } = withProjectAllocation(entry, { mode: 'single', project: project.value });
        return { id: entry.key, kind: 'invoice', targetKey: entry.key, canApply: true, fingerprint: JSON.stringify(entry),
          patch: { project: project.value, allocation, projectAllocations } };
      });
      const result = invoiceActions.applyAssignmentImport(review, review.map(entry => entry.id));
      emit('saved', '已调整 ' + result.invoicesUpdated + ' 张发票的工地。');
    } else {
      const result = invoiceActions.markReimbursedBatch(props.entries.map(entry => entry.key), date.value);
      emit('saved', '已标记 ' + result.marked + ' 张，原已报销 ' + result.already + ' 张，记录已移除 ' + result.missing + ' 张。');
    }
  } catch (error) { message.value = error.message; }
}
</script>

<template>
  <DialogRoot :open="true" @update:open="value => { if (!value) emit('close'); }">
    <DialogPortal>
      <DialogOverlay class="ui-overlay z-60" />
      <DialogContent class="ui-dialog z-61 w-[min(420px,94vw)] p-4">
        <DialogTitle class="text-base font-semibold">{{ changingProject ? '批量改工地' : '批量标记已报销' }}</DialogTitle>
        <DialogDescription class="my-2 text-xs text-ink-secondary">
          {{ changingProject ? '可更新 ' + eligible.length + ' 张。' + (eligible.length < entries.length ? '已有多工地分摊的 ' + (entries.length - eligible.length) + ' 张需进入详情逐张调整。' : '') : '为 ' + entries.length + ' 张所选发票登记报销日期。' }}
        </DialogDescription>
        <form class="grid gap-3" @submit.prevent="submit">
          <label v-if="changingProject" class="ui-label">目标工地<select v-model="project" class="ui-input" required><option value="">选择工地</option><option v-for="name in directory.projects" :key="name">{{ name }}</option></select></label>
          <label v-else class="ui-label">报销日期<input v-model="date" class="ui-input" type="date" required /></label>
          <p v-if="message" class="text-xs text-danger" role="alert">{{ message }}</p>
          <footer class="flex justify-end gap-2">
            <DialogClose type="button" class="ui-btn">取消</DialogClose>
            <button type="submit" class="ui-btn-primary" :disabled="invoiceStore.savingIntake || (changingProject ? !project || !eligible.length : !date)">确认</button>
          </footer>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup>
import { computed, ref } from 'vue';
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui';
import { supplementType } from '../lib/invoice-supplements.js';
import { allocationKind } from '../lib/payment-records.js';
import { isMultiProject, projectNames } from '../lib/invoice-allocation.js';
import { invoiceStore, invoiceActions } from '../invoiceStore.js';
import { directory } from '../lib/expense-directory.js';
import { EXPENSE_TAGS, inferExpenseTag } from '../lib/invoice-tags.js';
import { invoiceTypes, recentInvoiceProjects } from '../lib/invoice-workspace-fields.js';
import { toastWarn } from '../lib/toast.js';
import InvoiceMoneyField from './InvoiceMoneyField.vue';
import InvoiceProjectAllocationDialog from './InvoiceProjectAllocationDialog.vue';
import SearchSelect from './SearchSelect.vue';
import SupplierMatch from './SupplierMatch.vue';

const props = defineProps({ item: { type: Object, required: true }, reimbursementSelected: Boolean });
const emit = defineEmits(['select-reimbursement']);
const invoice = computed(() => props.item.inv);
const fields = computed(() => invoice.value.fields);
const previous = computed(() => invoice.value.history?.entry);
const assignment = computed(() => ({ ...(previous.value || fields.value), ...invoice.value.assignmentDraft }));
const allocationOpen = ref(false);
const allocationEntry = computed(() => previous.value || { ...fields.value, ...assignment.value, total: fields.value.total, key: invoice.value.id });
const allocations = computed(() => [...new Set(['指定工地', '公司开支', '加油', '个人报账', '待确认', ...directory.allocations, allocationKind(assignment.value)])]);
const projects = computed(() => [...new Set([...directory.projects, assignment.value.project].filter(Boolean))]);
const recent = computed(() => recentInvoiceProjects(Object.values(invoiceStore.ledger), directory.projects));
const kinds = computed(() => [...new Set([...invoiceTypes, fields.value.type].filter(Boolean))]);
const extraFields = [['payer', '付款人'], ['reimburser', '报销人'], ['paymentDate', '支付日期'], ['assignmentNote', '归属备注']];
const filledCount = computed(() => extraFields.filter(([key]) => String(assignment.value[key] || '').trim()).length + Number(!!fields.value.remark?.trim()));
const expenseTag = computed(() => invoice.value.expenseTagSet ? invoice.value.expenseTag : previous.value?.expenseTagSet ? previous.value.expenseTag : (invoice.value.expenseTag || previous.value?.expenseTag || inferExpenseTag(invoice.value)));

function markEdited() { invoiceActions.markDraftEdited(invoice.value); }
function applyAllocation(draft) {
  invoice.value.assignmentDraft = { ...invoice.value.assignmentDraft, ...draft };
  markEdited();
}
function setAssignment(key, value) {
  const draft = { ...invoice.value.assignmentDraft, [key]: value };
  if (key === 'project') draft.allocation = value ? '指定工地' : '待确认';
  if (key === 'allocation' && value !== '指定工地') draft.project = '';
  invoice.value.assignmentDraft = draft;
  markEdited();
}
function changeType(value) {
  fields.value.type = value;
  if (invoiceTypes.includes(value)) {
    fields.value.taxKind = /专用/.test(value) ? '专用发票' : /普通/.test(value) ? '普通发票' : '';
    fields.value.docType = value === '医疗收费电子票据' ? '医疗票据' : value === '其他票据' ? '未识别' : '增值税发票';
  }
  markEdited();
}
function changeTag(event) {
  try {
    const result = invoiceActions.setInvoiceExpenseTag(invoice.value, event.target.value);
    if (!result.ok) { toastWarn(result.message); event.target.value = expenseTag.value; }
  } catch (error) { toastWarn(`标签保存失败：${error.message || error}`); }
}
</script>

<template>
  <article class="review-workspace grid gap-3" :data-inv="invoice.id" @input="markEdited">
    <section class="ui-section grid gap-2" aria-label="票面核心信息">
      <div class="flex items-center justify-between gap-2"><h3 class="font-semibold">票面核心信息</h3><button class="ui-btn-danger h-7" type="button" @click="invoiceActions.removeInvoice(invoice.id)">移除</button></div>
      <div class="grid grid-cols-2 gap-2">
        <label class="ui-label col-span-2">发票号码<input v-model="fields.number" class="ui-input ui-money" /></label>
        <label class="ui-label">开票日期<input v-model="fields.date" class="ui-input" placeholder="YYYY-MM-DD" @input="fields.dateText = $event.target.value" /></label>
        <label class="ui-label col-span-2">销售方<input v-model="fields.seller" class="ui-input" /><SupplierMatch v-model="fields.seller" @update:model-value="markEdited" /></label>
        <label class="ui-label col-span-2">购买方<SearchSelect v-model="fields.buyer" :options="directory.buyers" label="购买方" placeholder="搜索档案或输入新抬头" allow-custom @update:model-value="markEdited" /></label>
        <label class="ui-label col-span-2">票种<select :value="fields.type" class="ui-input" @change="changeType($event.target.value)"><option value="">待识别</option><option v-for="kind in kinds" :key="kind">{{ kind }}</option></select></label>
        <InvoiceMoneyField v-model="fields.amount" label="不含税金额" />
        <InvoiceMoneyField v-model="fields.tax" label="税额" />
        <InvoiceMoneyField v-model="fields.total" label="价税合计" />
        <label class="ui-label">税率<input v-model="fields.rate" class="ui-input" placeholder="如 13%" /></label>
      </div>
    </section>
    <section v-if="!supplementType(fields) && !invoice.linkedLedgerKey && !invoice.paymentId" class="ui-section grid gap-2" aria-label="费用归属">
      <div class="flex items-center justify-between gap-2"><h3 class="font-semibold">费用归属</h3><button type="button" class="ui-btn-sm" @click="allocationOpen = true">工地分摊</button></div>
      <p v-if="isMultiProject(assignment)" class="text-xs text-ink-secondary">多工地分摊：{{ projectNames(assignment) || '待分配' }}</p>
      <template v-else>
        <label class="ui-label">归属类型<select :value="allocationKind(assignment)" class="ui-input" @change="setAssignment('allocation', $event.target.value)"><option v-for="kind in allocations" :key="kind">{{ kind }}</option></select></label>
        <label class="ui-label">使用工地<SearchSelect :model-value="assignment.project || ''" :options="projects" label="使用工地" @update:model-value="setAssignment('project', $event)" /></label>
        <div v-if="recent.length" class="flex flex-wrap items-center gap-1.5"><span class="text-xs text-ink-soft">近期常用</span><button v-for="project in recent" :key="project" class="ui-btn-sm" :aria-pressed="assignment.project === project" @click="setAssignment('project', project)">{{ project }}</button></div>
      </template>
      <label class="ui-label">费用标签<select :value="expenseTag" class="ui-input" @change.stop="changeTag"><option value="">未分类</option><option v-for="tag in EXPENSE_TAGS" :key="tag">{{ tag }}</option></select></label>
      <InvoiceProjectAllocationDialog v-if="allocationOpen" :entry="allocationEntry" :draft="!previous" @apply="applyAllocation" @close="allocationOpen = false" />
    </section>
    <CollapsibleRoot class="ui-section" :class="filledCount ? 'filled-section' : 'border-dashed'">
      <CollapsibleTrigger class="ui-focus flex w-full items-center justify-between gap-2 text-left font-semibold">经手、付款与备注 <span :class="filledCount ? 'ui-badge-brand' : 'ui-badge-neutral'">{{ filledCount ? `已填 ${filledCount} 项` : '未填写' }} ▾</span></CollapsibleTrigger>
      <CollapsibleContent class="mt-3 grid grid-cols-2 gap-2">
        <label v-for="[key, label] in extraFields" :key="key" class="ui-label">{{ label }}<input :type="key === 'paymentDate' ? 'date' : 'text'" :value="assignment[key] || ''" class="ui-input" @change="setAssignment(key, $event.target.value)" /></label>
        <label class="ui-label col-span-2">票面备注<textarea v-model="fields.remark" class="ui-textarea" /></label>
      </CollapsibleContent>
    </CollapsibleRoot>
    <label class="flex items-center gap-2 text-xs text-ink-secondary"><input type="checkbox" :checked="reimbursementSelected" @input.stop @change="emit('select-reimbursement', invoice.id, $event.target.checked)" /> 加入批量报销操作</label>
  </article>
</template>

<style scoped>
.filled-section { border-inline-start: 3px solid #1867c0; }
.review-workspace :deep(.search-select-input input) { height: 30px; }
</style>

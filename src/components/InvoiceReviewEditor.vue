<script setup>
import { isMultiProject, projectNames } from '../lib/invoice-allocation.js';
import ExpenseAllocationSelect from './ExpenseAllocationSelect.vue';
import SupplierMatch from './SupplierMatch.vue';
import SearchSelect from "./SearchSelect.vue";
import InvoiceMoneyField from './InvoiceMoneyField.vue';
import UiDisclosure from './UiDisclosure.vue';
import { useExpenseOptions } from "../composables/useExpenseOptions";
import { invoiceTypes, recentInvoiceProjects } from '../lib/invoice-workspace-fields.js';
const expenseChoices = useExpenseOptions();
import { computed, ref, watch } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { invoiceProblems } from '../lib/invoice-review';
import { allocationKind } from '../lib/payment-records';
import { directory } from '../lib/expense-directory';
const props=defineProps({entry:Object}); const emit=defineEmits(['close']);
const draft=ref({}); const message=ref(''); const checked=ref(false);
watch(()=>props.entry, e=>{draft.value={...e,allocation:allocationKind(e)};checked.value=false;message.value='';},{immediate:true});
const problems=computed(()=>[...invoiceProblems(draft.value), ...(draft.value.allocation==='指定工地' && !draft.value.project ? ['请选择工地，或改选加油、个人报账、待确认'] : [])]);
const kinds = computed(() => [...new Set([...invoiceTypes, draft.value.type].filter(Boolean))]);
const recent = computed(() => recentInvoiceProjects(Object.values(invoiceStore.ledger), directory.projects));
const fields=[['service','费用名称'],['purpose','用途'],['expenseOwner','费用归属人'],['paymentDate','支付日期'],['payer','付款人'],['reimburser','报销人'],['assignmentNote','归属备注'],['remark','备注']];
const filled = computed(() => fields.filter(([key]) => String(draft.value[key] || '').trim()).length);
function save(){try{const r=invoiceActions.saveReviewedInvoice(props.entry.key,draft.value);if(r.ok)emit('close');else message.value=r.message;}catch(e){message.value=e.message;}}
</script>
<template>
  <section aria-label="编辑与复核发票" class="review-editor grid gap-3" @input="checked = false">
    <h3>编辑与复核 · {{ entry.number }}</h3>
    <div class="grid grid-cols-2 gap-2">
      <label class="ui-label">发票日期<input v-model="draft.date" class="ui-input" type="date" /></label>
      <label class="ui-label">票种<select v-model="draft.type" class="ui-input" @change="checked = false"><option value="">待确定</option><option v-for="kind in kinds" :key="kind">{{ kind }}</option></select></label>
      <label class="ui-label">购买方<SearchSelect v-model="draft.buyer" :options="directory.buyers" label="购买方" allow-custom @update:model-value="checked = false" /></label>
      <label class="ui-label">销售方 / 厂家<input v-model="draft.seller" class="ui-input" /><SupplierMatch v-model="draft.seller" @update:model-value="checked = false" /></label>
      <InvoiceMoneyField v-model="draft.amount" label="金额（不含税）" />
      <InvoiceMoneyField v-model="draft.tax" label="税额" />
      <InvoiceMoneyField v-model="draft.total" label="价税合计" />
    </div>
    <p v-if="isMultiProject(entry)">多工地分配：{{ projectNames(entry) || '待分配' }}（请在工地分配中调整）</p>
    <template v-else>
      <label class="ui-label">费用归属<ExpenseAllocationSelect v-model="draft.allocation" v-model:project="draft.project" v-model:buyer="draft.buyer" @change="checked = false" /></label>
      <div v-if="recent.length" class="flex flex-wrap items-center gap-1.5"><span>近期常用</span><button v-for="project in recent" :key="project" class="ui-btn-sm" @click="draft.project = project; draft.allocation = '指定工地'; checked = false">{{ project }}</button></div>
    </template>
    <UiDisclosure class="ui-section border-l-3" :class="filled ? 'border-l-brand' : 'border-dashed'">
      <template #label>经手、付款与备注 <span :class="filled ? 'ui-badge-brand' : 'ui-badge'">{{ filled ? `已填 ${filled} 项` : '未填写' }}</span></template>
      <div class="grid grid-cols-2 gap-2">
        <label v-for="[key, label] in fields" :key="key" class="ui-label">{{ label }}<SearchSelect v-if="expenseChoices[key]" v-model="draft[key]" :options="expenseChoices[key]" :label="label" :allow-custom="key === 'purpose'" @update:model-value="checked = false" /><input v-else v-model="draft[key]" class="ui-input" :type="key === 'paymentDate' ? 'date' : 'text'" /></label>
      </div>
    </UiDisclosure>
    <ul v-if="problems.length" role="alert"><li v-for="problem in problems" :key="problem">{{ problem }}</li></ul>
    <label class="inline-check review-confirm"><input v-model="checked" type="checkbox" @input.stop /> 我已对照原件确认买卖方、日期和金额</label>
    <p v-if="message" role="alert">{{ message }}</p>
    <div class="flex gap-2"><button class="btn-primary" :disabled="problems.length > 0 || !checked" @click="save">保存复核结果</button><button class="btn" @click="emit('close')">取消编辑</button></div>
  </section>
</template>
<style scoped>.review-editor{padding:12px;background:#fff;border:1px solid #cbd5e1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;font-size:13px}input{width:100%}input[type=checkbox]{width:auto}ul{color:#b91c1c}p{font-size:12px}</style>

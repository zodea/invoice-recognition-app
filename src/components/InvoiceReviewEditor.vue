<script setup>
import SearchSelect from "./SearchSelect.vue";
import { useExpenseOptions } from "../composables/useExpenseOptions";
const expenseChoices = useExpenseOptions();
import { computed, ref, watch } from 'vue';
import { invoiceActions } from '../invoiceStore';
import { invoiceProblems } from '../lib/invoice-review';
import { allocationKind } from '../lib/payment-records';
import { directory, suggestAllocation } from '../lib/expense-directory';
const props=defineProps({entry:Object}); const emit=defineEmits(['close']);
const draft=ref({}); const message=ref(''); const checked=ref(false);
watch(()=>props.entry, e=>{draft.value={...e,allocation:allocationKind(e)};checked.value=false;message.value='';},{immediate:true});
const problems=computed(()=>[...invoiceProblems(draft.value), ...(draft.value.allocation==='指定工地' && !draft.value.project ? ['请选择工地，或改选加油、个人报账、待确认'] : [])]);
const suggestion=computed(()=>suggestAllocation(draft.value.seller,draft.value.buyer));
const fields=[['date','发票日期'],['paymentDate','支付日期'],['buyer','购买方'],['seller','销售方 / 厂家'],['type','票种'],['amount','金额（不含税）'],['tax','税额'],['total','价税合计'],['project','工地'],['service','费用名称'],['remark','备注'],['purpose','用途'],['payer','付款人'],['reimburser','报销人']];
function save(){try{const r=invoiceActions.saveReviewedInvoice(props.entry.key,draft.value);if(r.ok)emit('close');else message.value=r.message;}catch(e){message.value=e.message;}}
</script>
<template><section aria-label="编辑与复核发票" class="review-editor finance-form"><h3>编辑与复核 · {{ entry.number }}</h3><label>费用归属<select v-model="draft.allocation" @change="checked=false" class="field-input"><option>指定工地</option><option>加油</option><option>个人报账</option><option>待确认</option></select></label><p v-if="draft.allocation==='待确认'">费用归属待确认</p><div class="form-grid"><label v-for="[key,label] in fields" :key="key">{{ label }}<SearchSelect v-if="expenseChoices[key]" v-model="draft[key]" :options="expenseChoices[key]" :label="label" :allow-custom="key==='purpose'" @update:model-value="checked=false" /><input v-else v-model="draft[key]" class="field-input" :type="['date','paymentDate'].includes(key)?'date':'text'" :list="key==='buyer'?'review-buyers':key==='project'?'review-projects':undefined" @input="checked=false" /></label></div><datalist id="review-buyers"><option v-for="b in directory.buyers" :key="b">{{ b }}</option></datalist><datalist id="review-projects"><option v-for="p in directory.projects" :key="p">{{ p }}</option></datalist><button v-if="suggestion" class="btn" @click="draft.buyer=suggestion.buyer;draft.project=suggestion.project;draft.allocation='指定工地';checked=false">采用厂家对应关系：{{ suggestion.buyer }} / {{ suggestion.project }}</button><ul v-if="problems.length" role="alert"><li v-for="p in problems" :key="p">{{ p }}</li></ul><label class="inline-check review-confirm"><input v-model="checked" type="checkbox" /> 我已对照原件确认买卖方、日期和金额</label><p role="alert">{{ message }}</p><button class="btn-primary" :disabled="problems.length>0 || !checked" @click="save">保存复核结果</button> <button class="btn" @click="emit('close')">取消编辑</button></section></template>
<style scoped>.review-editor{padding:12px;background:#fff;border:1px solid #cbd5e1}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;font-size:13px}input{width:100%}input[type=checkbox]{width:auto}ul{color:#b91c1c}p{font-size:12px}</style>

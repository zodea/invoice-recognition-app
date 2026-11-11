<script setup>
import { computed } from 'vue';
import { directory, isAllocationRuleActive } from '../lib/expense-directory.js';
const props=defineProps({modelValue:String,project:String,buyer:String});
const emit=defineEmits(['update:modelValue','update:project','update:buyer','change']);
const rules=computed(()=>directory.rules.filter(isAllocationRuleActive));
const choices=computed(()=>[...new Set(['指定工地','加油','个人报账','待确认',...(directory.allocations||[]),props.modelValue].filter(Boolean))]);
const selected=computed(()=>props.modelValue==='指定工地'&&directory.projects.includes(props.project)?'project:'+props.project:'allocation:'+(props.modelValue||'待确认'));
function choose(value){if(value.startsWith('rule:')){const rule=rules.value[Number(value.slice(5))];if(!rule)return;emit('update:project',rule.project);emit('update:buyer',rule.buyer);emit('update:modelValue','指定工地');}else if(value.startsWith('project:')){emit('update:project',value.slice(8));emit('update:modelValue','指定工地');}else{emit('update:modelValue',value.slice(11));if(value!=='allocation:指定工地')emit('update:project','');}emit('change');}
</script>
<template><select :value="selected" class="field-input" @change="choose($event.target.value)"><optgroup label="费用归属"><option v-for="v in choices" :key="v" :value="'allocation:'+v">{{ v }}</option></optgroup><optgroup v-if="directory.projects.length" label="已建工地"><option v-for="p in directory.projects" :key="p" :value="'project:'+p">{{ p }}</option></optgroup><optgroup v-if="rules.length" label="已建厂家归属（手动采用）"><option v-for="(rule,index) in rules" :key="index" :value="'rule:'+index">{{ rule.seller }} · {{ rule.buyer }} / {{ rule.project }}</option></optgroup></select></template>

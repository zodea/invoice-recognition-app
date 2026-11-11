<script setup>
import { computed } from 'vue';
import { supplierStore,matchSupplierExact,coreCompanyName } from '../lib/supplier-db.js';
const props=defineProps({modelValue:String});const emit=defineEmits(['update:modelValue']);
const matched=computed(()=>matchSupplierExact(supplierStore.list,props.modelValue)?.supplier);
const candidates=computed(()=>{if(matched.value)return [];const n=coreCompanyName(props.modelValue);if(n.length<2)return [];return supplierStore.list.filter(s=>[s.name,s.shortName,...s.aliases||[]].some(v=>{const a=coreCompanyName(v);return a.length>=2&&(a.includes(n)||n.includes(a));})).slice(0,8);});
</script>
<template><small v-if="matched" class="supplier-match">已匹配分供方：{{ matched.name }} · {{ matched.type || '大宗供应商' }}</small><div v-else-if="candidates.length" class="supplier-match">可能对应以下档案，请对照原件选择：<button v-for="s in candidates" :key="s.id" type="button" class="text-action" @click="emit('update:modelValue',s.name)">{{ s.name }}</button></div><small v-else-if="modelValue" class="supplier-match">未匹配分供方档案</small></template>
<style scoped>.supplier-match{display:block;font-size:11px;color:#74859b;margin-top:5px;line-height:1.6}.supplier-match button{display:block;text-align:left}</style>

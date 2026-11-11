<script setup>
import { computed } from 'vue';
import UiTag from './UiTag.vue';
import { invoiceTypeTags } from '../lib/invoice-type-tags';
const props = defineProps({entry:{type:Object,required:true}});
const tags = computed(()=>invoiceTypeTags(props.entry));
const fullName = computed(()=>[...new Set([props.entry.type,props.entry.taxKind,props.entry.typeLabel].filter(Boolean))].join(' · ') || props.entry.docType || '未识别类型');
</script>
<template><span class="invoice-type-tags" :title="fullName" :aria-label="fullName"><UiTag v-for="tag in tags" :key="tag.label" :tone="tag.tone">{{ tag.label }}</UiTag><span v-if="!tags.length">—</span></span></template>
<style scoped>.invoice-type-tags{display:inline-flex;align-items:center;gap:5px;vertical-align:middle}</style>

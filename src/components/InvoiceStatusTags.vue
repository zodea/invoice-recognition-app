<script setup>
import { computed } from 'vue';
import UiTag from './UiTag.vue';
import { invoiceStatusTags } from '../lib/invoice-status-display';
const props=defineProps({entry:{type:Object,required:true}});
const tags=computed(()=>invoiceStatusTags(props.entry));
</script>
<template><span class="invoice-status-tags" :title="entry.invoiceStatus || undefined"><UiTag v-for="tag in tags" :key="tag.label" :tone="tag.tone">{{ tag.label }}</UiTag><span v-if="!tags.length">—</span></span></template>
<style scoped>.invoice-status-tags{display:inline-flex;align-items:center;gap:5px}</style>

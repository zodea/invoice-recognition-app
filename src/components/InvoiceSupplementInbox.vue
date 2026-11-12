<script setup>
import {computed,shallowRef} from 'vue';
import {invoiceActions,invoiceStore} from '../invoiceStore.js';
import InvoiceSupplementLink from './InvoiceSupplementLink.vue';
const message=shallowRef('');
const pending=computed(()=>invoiceStore.supplements.filter(r=>!r.ledgerKey));
async function retry(){try{const r=await invoiceActions.retrySupplementMatches();message.value=`已自动关联 ${r.linked} 份，${r.pending} 份继续保留待匹配。`;}catch(error){message.value=error.message;}}
</script>
<template><details v-if="pending.length" class="supplement-inbox"><summary>已保存的附件待匹配（{{ pending.length }}）</summary><div class="inbox-actions"><span>原件已保存，关闭软件也会保留。主票保存后会自动匹配，不增加费用。</span><button type="button" class="btn" @click="retry">重新自动匹配</button></div><p v-if="message" role="status">{{ message }}</p><div v-for="record in pending" :key="record.hash" class="inbox-row"><strong>{{ record.name }}</strong><InvoiceSupplementLink :record="record" :fields="record.fields" /></div></details></template>
<style scoped>.supplement-inbox{padding:10px;background:#fff;border:1px solid #dce4ee;border-radius:6px;font-size:12px}.supplement-inbox summary{cursor:pointer;font-weight:700}.inbox-actions{display:flex;gap:12px;align-items:center;padding:8px 0;color:#64748b}.inbox-row{display:grid;gap:7px;padding:10px 0;border-top:1px solid #e5eaf1}</style>

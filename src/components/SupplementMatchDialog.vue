<script setup>
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { computed, shallowRef, watch } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { supplementInvoiceCandidates, searchSupplementInvoices } from '../lib/invoice-supplements.js';
import { toast } from '../lib/toast.js';
const selected=shallowRef(''),message=shallowRef('');
const record=computed(()=>invoiceStore.supplements.find(r=>r.hash===invoiceStore.matchSupplementHash && !r.ledgerKey));
const query=shallowRef('');
const candidates=computed(()=>record.value ? supplementInvoiceCandidates(record.value,invoiceStore.ledger) : []);
const results=computed(()=>{
  const all=searchSupplementInvoices(invoiceStore.ledger,query.value);
  const rank=new Map(candidates.value.map((item,index)=>[item.entry.key,index]));
  return all.sort((a,b)=>(rank.get(a.key)??Infinity)-(rank.get(b.key)??Infinity));
});
const chosen=computed(()=>selected.value && invoiceStore.ledger[selected.value]);
const hint=key=>candidates.value.find(item=>item.entry.key===key)?.hint||'手动选择';
function close(){invoiceStore.matchSupplementHash='';}
watch(()=>invoiceStore.matchSupplementHash,()=>{ selected.value=''; query.value=''; message.value=''; });
async function link(){
 try { await invoiceActions.confirmSupplementLink(record.value.hash,selected.value); close(); toast('行程或费用明细已关联主发票'); }
 catch(error){message.value=error.message;}
}
</script>
<template>
  <DialogRoot :open="!!record" @update:open="value => { if (!value) close(); }"><DialogPortal><DialogOverlay class="file-import-overlay" />
    <DialogContent class="file-import-dialog supplement-dialog">
      <header><DialogTitle>选择关联发票</DialogTitle><DialogClose class="btn">关闭</DialogClose></header>
      <DialogDescription>{{ record?.name }} · 从已保存的历史进项台账中选择主票，关联后可在发票详情中查看原件。</DialogDescription>
      <label>搜索发票<input v-model="query" class="field-input" placeholder="票号、销售方、购买方、日期或金额" @input="selected=''" /></label>
      <span>{{ results.length }} 张主票<span v-if="results.length>60">，先显示 60 张，可输入更多条件</span></span>
      <div class="supplement-results"><label v-for="entry in results.slice(0,60)" :key="entry.key">
        <input type="radio" v-model="selected" :value="entry.key" /><span><strong>{{ entry.number || entry.key }}</strong> · {{ entry.date || '日期未知' }} · {{ entry.total ?? '—' }} 元<br>{{ entry.seller || '销售方未知' }} → {{ entry.buyer || '购买方未知' }}<br><small>{{ hint(entry.key) }}</small></span>
      </label><p v-if="!results.length">没有符合条件的主票。可调整搜索条件，或先把发票保存到历史进项台账。</p></div>
      <p v-if="chosen">将关联发票 {{ chosen.number || selected }} · {{ chosen.seller }} · {{ chosen.total }} 元</p>
      <p v-if="message" role="status">{{ message }}</p>
      <button class="btn-primary" :disabled="!chosen||invoiceStore.savingIntake" @click="link">确认关联所选主票</button>
    </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.supplement-dialog { width:min(600px,94vw); font-size:13px; }
.supplement-dialog p,.supplement-note { overflow-wrap:anywhere; }
.supplement-dialog>label { display:grid; gap:5px; }
.supplement-results { overflow:auto; max-height:40dvh; min-height:0; display:grid; align-content:start; }
.supplement-results label { display:grid; grid-template-columns:auto minmax(0,1fr); align-items:start; gap:8px; padding:8px; border-top:1px solid #e0e6ec; overflow-wrap:anywhere; cursor:pointer; }
.supplement-results small { color:#4d6580; }
</style>

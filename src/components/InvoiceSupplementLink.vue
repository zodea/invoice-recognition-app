<script setup>
import {computed,shallowRef,watch} from 'vue';
import {invoiceActions,invoiceStore} from '../invoiceStore.js';
import {getLedgerAttachment} from '../lib/ledger-attachments.js';
import {downloadBytes} from '../lib/file-utils.js';
const props=defineProps({invoice:Object,file:Object,fields:Object,paymentId:String,record:Object,name:String});
const emit=defineEmits(['linked']);
const hash=shallowRef(''),message=shallowRef('');
const record=computed(()=>invoiceStore.supplements.find(r=>r.hash===(props.record?.hash||props.invoice?.supplementHash||hash.value)));
const waitingFor=computed(()=>record.value && !record.value.ledgerKey ? invoiceActions.matchingDraftNumber(record.value) : '');
function show(){invoiceStore.matchSupplementHash=record.value.hash;}
async function save(){try{const result=await invoiceActions.saveSupplement({invoice:props.invoice,file:props.file,fields:props.fields,name:props.name,paymentId:props.paymentId});hash.value=result.record.hash;message.value=result.record.ledgerKey?'已保存并自动关联主发票，不重复计费':'附件原件已保存，等待主票到齐或确认候选';if(result.record.ledgerKey)emit('linked',result.record.ledgerKey);else invoiceStore.matchSupplementHash=result.record.hash;}catch(error){message.value=error.message;}}
watch(()=>record.value?.ledgerKey,key=>{ if(key && props.paymentId)emit('linked',key); });
async function download(){try{const original=await getLedgerAttachment('supplement:'+record.value.hash);if(!original?.blob)throw new Error('未找到附件原件');downloadBytes(new Uint8Array(await original.blob.arrayBuffer()),record.value.name,original.blob.type);}catch(error){message.value=error.message;}}
</script>
<template>
 <section class="supplement-link" aria-label="保存发票附件">
  <button v-if="!record" type="button" class="btn-primary" :disabled="invoiceStore.savingIntake||!(file||invoice?.blob)" @click="save">保存并匹配主发票</button>
  <span v-else-if="record.ledgerKey" class="supplement-note">已作为发票 {{ record.ledgerKey }} 的附件保存 · 不计费</span>
  <button v-else type="button" class="btn-primary" @click="show">选择关联发票</button>

  <span v-if="waitingFor" class="supplement-note">已匹配本批发票 {{ waitingFor }}，主票入账后关联</span>
  <button v-if="record" type="button" class="btn" @click="download">下载附件原件</button>
  <span v-if="message" role="status" class="supplement-note">{{ message }}</span>
 </section>
</template>
<style scoped>.supplement-link{display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%}.supplement-note{font-size:12px;color:#64748b}.supplement-link .field-input{max-width:100%;font-size:12px}.supplement-link .btn-primary,.supplement-link .btn{font-size:12px;padding:6px 10px;white-space:nowrap}
</style>

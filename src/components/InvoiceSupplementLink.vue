<script setup>
import {computed,shallowRef} from 'vue';
import {invoiceActions,invoiceStore} from '../invoiceStore.js';
import {supplementInvoiceCandidates} from '../lib/invoice-supplements.js';
import {getLedgerAttachment} from '../lib/ledger-attachments.js';
import {downloadBytes} from '../lib/file-utils.js';
const props=defineProps({invoice:Object,file:Object,fields:Object,paymentId:String,record:Object,name:String});
const emit=defineEmits(['linked']);
const hash=shallowRef(''),selected=shallowRef(''),message=shallowRef('');
const record=computed(()=>invoiceStore.supplements.find(r=>r.hash===(props.record?.hash||props.invoice?.supplementHash||hash.value)));
const candidates=computed(()=>record.value?supplementInvoiceCandidates(record.value,invoiceStore.ledger).filter(c=>c.score>=6||c.strong||c.conflict).slice(0,8):[]);
async function save(){try{const result=await invoiceActions.saveSupplement({invoice:props.invoice,file:props.file,fields:props.fields,name:props.name,paymentId:props.paymentId});hash.value=result.record.hash;message.value=result.record.ledgerKey?'已保存并自动关联主发票，不重复计费':'附件原件已保存，等待主票到齐或确认候选';if(result.record.ledgerKey)emit('linked',result.record.ledgerKey);}catch(error){message.value=error.message;}}
async function link(){try{await invoiceActions.confirmSupplementLink(record.value.hash,selected.value);message.value='已关联，费用只按主发票计算';emit('linked',selected.value);}catch(error){message.value=error.message;}}
async function download(){try{const original=await getLedgerAttachment('supplement:'+record.value.hash);if(!original?.blob)throw new Error('未找到附件原件');downloadBytes(new Uint8Array(await original.blob.arrayBuffer()),record.value.name,original.blob.type);}catch(error){message.value=error.message;}}
</script>
<template>
 <section class="supplement-link" aria-label="保存发票附件">
  <button v-if="!record" type="button" class="btn-primary" :disabled="invoiceStore.savingIntake||!(file||invoice?.blob)" @click="save">保存附件并自动匹配</button>
  <span v-else-if="record.ledgerKey" class="supplement-note">已作为发票 {{ record.ledgerKey }} 的附件保存 · 不计费</span>
  <template v-else><span class="supplement-note">附件已保存，不计费。{{ candidates.length?'请选择唯一对应的主票；不会自动强配。':'主票到齐后自动再匹配。' }}</span><select v-if="candidates.length" v-model="selected" class="field-input" aria-label="附件的主发票候选"><option value="">确认主票候选</option><option v-for="candidate in candidates" :key="candidate.entry.key" :value="candidate.entry.key">{{ candidate.hint }} · {{ candidate.entry.number }} · {{ candidate.entry.date }} · {{ candidate.entry.total }}元 · {{ candidate.entry.seller }}</option></select><button v-if="candidates.length" type="button" class="btn" :disabled="!selected||invoiceStore.savingIntake" @click="link">确认关联所选主票</button></template>
  <button v-if="record" type="button" class="btn" @click="download">下载附件原件</button>
  <span v-if="message" role="status" class="supplement-note">{{ message }}</span>
 </section>
</template>
<style scoped>.supplement-link{display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:100%}.supplement-note{font-size:12px;color:#64748b}.supplement-link .field-input{max-width:100%;font-size:12px}.supplement-link .btn-primary,.supplement-link .btn{font-size:12px;padding:6px 10px;white-space:nowrap}</style>

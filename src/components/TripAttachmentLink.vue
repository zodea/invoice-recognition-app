<script setup>
import { computed, ref } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { tripInvoiceCandidates } from '../lib/invoice-intake.js';
import { toast, toastError } from '../lib/toast.js';
import ConfirmAction from './ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
const props = defineProps({ file: Object, fields: { type: Object, required: true }, paymentId: String, invoice: Object });
const emit = defineEmits(['linked']);
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const query = ref(''), selected = ref('');
const candidates = computed(() => tripInvoiceCandidates(props.fields, invoiceStore.ledger, query.value).slice(0,50));
async function link() {
  const target = invoiceStore.ledger[selected.value];
  if (!target) return;
  if (!await requestConfirmation('关联行程单', '将此行程单作为发票 '+target.number+' 的附件？费用只按主发票计算，行程单不再单独计费。日期、金额相同仅为匹配建议，请对照原件确认。', '确认关联')) return;
  try {
    await invoiceActions.linkTripAttachment({ file: props.file, fields: props.fields, ledgerKey: target.key, paymentId: props.paymentId, invoice: props.invoice });
    toast('已关联主发票，行程单不重复计入费用。'); emit('linked', target.key);
  } catch (error) { toastError('关联失败：'+error.message); }
}
</script>
<template>
  <div class="trip-link">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <strong>行程单关联主发票</strong><p>先保存主发票，再选择对应记录；匹配建议需对照原件确认。</p>
    <input v-model="query" class="field-input" placeholder="搜索主发票号码、公司或日期" aria-label="搜索主发票" />
    <select v-model="selected" class="field-input" aria-label="选择主发票"><option value="">选择主发票（最多显示 50 条，请搜索缩小范围）</option><option v-for="candidate in candidates" :key="candidate.entry.key" :value="candidate.entry.key">{{ candidate.hint }} · {{ candidate.entry.number }} · {{ candidate.entry.date }} · ¥{{ candidate.entry.total }} · {{ candidate.entry.seller }}</option></select>
    <button class="btn" :disabled="!selected || !file || invoiceStore.savingIntake" @click="link">关联为附件</button>
  </div>
</template>
<style scoped>.trip-link{display:grid;gap:7px;border-top:1px solid #dce4ee;padding-top:10px;font-size:12px}.trip-link p{margin:0;color:#64748b;line-height:1.5}.trip-link .field-input{min-width:0;width:100%;font-size:12px}.trip-link .btn{justify-self:start;font-size:12px;padding:5px 9px}</style>

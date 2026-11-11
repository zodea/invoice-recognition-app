<script setup>
import { computed } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { receiptType } from '../lib/invoice-intake.js';
import { directory } from '../lib/expense-directory.js';
import { toast, toastError, toastWarn } from '../lib/toast.js';
import ConfirmAction from './ConfirmAction.vue';
import TripAttachmentLink from './TripAttachmentLink.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
const props = defineProps({ invoice: { type: Object, required: true } });
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const decision = computed(() => invoiceActions.intakeDecision(props.invoice));
const finished = computed(() => ['saved','payment-saved','linked'].includes(decision.value.state));
async function saveInvoice() {
  try { const result = await invoiceActions.saveRecognizedInvoices([props.invoice]); if (result.failed) toastError(result.errors.join('；')); else if (result.saved) toast('已保存到历史进项台账'); else toastWarn(decision.value.reason); }
  catch (error) { toastError(error.message); }
}
async function markOther() {
  if (!await requestConfirmation('确认其他票据', '确认这不是需要计入本公司进项台账的发票？将加上“其他票据”标签，随后可保存到付款凭证。票面购买方原文会保留。', '标记其他票据')) return;
  props.invoice.otherReceiptConfirmed = true;
  props.invoice.otherReceiptTag = '其他票据';
  props.invoice.include = false;
}
async function transfer() {
  try { const result = await invoiceActions.transferOtherReceipt(props.invoice); toast(result.existing?'该原件已在付款凭证中，未重复新增':'已转入付款凭证，请核对原件和费用归属'); }
  catch (error) { toastError(error.message); }
}
function recheckInvoice() {
  props.invoice.otherReceiptConfirmed = false;
  if (receiptType(props.invoice.fields)) { props.invoice.fields.docType = '增值税发票'; props.invoice.fields.type = ''; }
}
</script>
<template>
  <section class="intake-review" :class="{finished}" aria-label="票据入账检查">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <strong>{{ decision.label }}</strong><p>{{ decision.reason }}</p>
    <p v-if="decision.state==='review' && !directory.buyers.length">请先在基础档案添加购买方公司。</p>
    <p v-else-if="decision.state==='review'">识别错误：在下方修正购买方等字段，匹配后保存。确实是其他票据：标记后转到付款凭证。</p>
    <div class="intake-buttons">
      <button v-if="decision.state==='ready'" class="btn-primary" :disabled="invoiceStore.savingIntake" @click="saveInvoice">保存到台账</button>
      <button v-if="['review','ready'].includes(decision.state)" class="btn" :disabled="invoiceStore.savingIntake" @click="markOther">标记其他票据</button>
      <template v-if="decision.state==='receipt'"><span class="receipt-label">其他票据</span><button class="btn-primary" :disabled="invoiceStore.savingIntake" @click="transfer">保存到付款凭证</button><button class="btn" @click="recheckInvoice">这是发票，重新核对</button></template>
    </div>
    <TripAttachmentLink v-if="receiptType(invoice.fields)==='行程单' && ['receipt','payment-saved'].includes(decision.state)" :file="invoice.blob" :fields="invoice.fields" :payment-id="invoice.paymentId" :invoice="invoice" />
  </section>
</template>
<style scoped>.intake-review{background:#fffbeb;border:1px solid #eee0b5;border-radius:6px;padding:10px;font-size:12px;margin-bottom:10px}.intake-review.finished{background:#f1f8f3;border-color:#d5e8da}.intake-review p{margin:5px 0;line-height:1.6;color:#6c5a32}.intake-buttons{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}.intake-buttons button{padding:5px 8px;font-size:12px;min-height:30px}.receipt-label{padding:3px 6px;background:#e8eff8;color:#38618c;border-radius:4px}</style>

<script setup>
import { computed } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { receiptType } from '../lib/invoice-intake.js';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { toast, toastError, toastWarn } from '../lib/toast.js';
import ConfirmAction from './ConfirmAction.vue';
import InvoiceSupplementLink from './InvoiceSupplementLink.vue';
import {supplementType} from '../lib/invoice-supplements.js';
import { useConfirmation } from '../composables/useConfirmation.js';
const emit=defineEmits(['open-payment','match-payment']);
const props = defineProps({ invoice: { type: Object, required: true } });
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const decision = computed(() => invoiceActions.intakeDecision(props.invoice));
const finished = computed(() => ['saved','payment-saved','linked','attachment-saved'].includes(decision.value.state));
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
  try { const result = await invoiceActions.transferOtherReceipt(props.invoice); toast(result.existing?'已找到这份原件的付款记录':'付款凭证已保存');emit('open-payment',result.row.id); }
  catch (error) { toastError(error.message); }
}
function recheckInvoice() {
  props.invoice.otherReceiptConfirmed = false;
  if (receiptType(props.invoice.fields)) { props.invoice.fields.docType = '增值税发票'; props.invoice.fields.type = ''; }
}
</script>
<template>
  <div class="intake-review" aria-label="票据入账检查">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <button v-if="decision.state==='ready'" type="button" class="btn-primary" :disabled="invoiceStore.savingIntake" @click="saveInvoice">确认保存</button>
    <button v-if="decision.state==='receipt' && !invoice.paymentMatchNote" class="btn-primary" :disabled="invoiceStore.savingIntake" @click="transfer">保存付款凭证</button>
    <button v-if="decision.state==='receipt' && invoice.blob" class="btn" @click="emit('match-payment',[invoice.blob])">核对付款清单</button>
    <span v-if="decision.state==='receipt' && invoice.paymentMatchNote" role="status">{{ invoice.paymentMatchNote }}</span>
    <button v-if="decision.state==='payment-saved'" class="btn" @click="emit('open-payment',invoice.paymentId)">查看付款记录</button>
    <InvoiceSupplementLink v-if="supplementType(invoice.fields)" :invoice="invoice" :fields="invoice.fields" :file="invoice.blob" />
    <TooltipProvider :delay-duration="150">
      <TooltipRoot>
        <TooltipTrigger class="intake-tag" :class="{ issue: decision.state==='review', finished }" :aria-label="decision.state==='review' ? '问题：'+decision.reason : decision.label+'：'+decision.reason">{{ decision.state==='review' ? '问题' : decision.label }}</TooltipTrigger>
        <TooltipPortal><TooltipContent class="intake-tooltip" side="bottom" align="end" :side-offset="7">{{ decision.reason }}</TooltipContent></TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
    <PopoverRoot v-if="!finished">
      <PopoverTrigger class="intake-more" aria-label="更多票据处理操作">更多 ▾</PopoverTrigger>
      <PopoverPortal><PopoverContent class="intake-menu" side="bottom" align="end" :side-offset="7">
        <button v-if="['ready','review'].includes(decision.state)" class="btn" @click="invoice.fields.attachmentType='行程及费用明细';invoice.include=false">作为发票附件保存</button>
        <button v-if="['review','ready'].includes(decision.state)" class="btn" :disabled="invoiceStore.savingIntake" @click="markOther">标记为其他票据</button>
        <template v-if="decision.state==='receipt'"><button class="btn" @click="invoice.fields.attachmentType='付款凭证附件';invoice.include=false">作为附件关联主发票</button><button class="btn" @click="recheckInvoice">这是发票，重新核对</button></template>
      </PopoverContent></PopoverPortal>
    </PopoverRoot>
  </div>
</template>
<style>
.intake-review{display:flex;align-items:center;gap:6px;min-width:0;max-width:100%;flex-wrap:wrap}
.intake-tag,.intake-more{font:inherit;font-size:12px;line-height:20px;padding:2px 7px;border-radius:4px;cursor:pointer;white-space:nowrap}
.intake-tag{color:#38618c;background:#edf3fa;border:1px solid #dce7f3}
.intake-tag.issue{color:#98600e;background:#fff7e5;border-color:#f0dbb0}
.intake-tag.finished{color:#397149;background:#f1f8f3;border-color:#d5e8da}
.intake-more{background:transparent;border:1px solid transparent;color:#64748b}
.intake-more:hover{background:#f1f5f9}
.intake-tag:focus-visible,.intake-more:focus-visible{outline:2px solid #1769c2;outline-offset:2px}
.intake-tooltip{z-index:2100;max-width:min(300px,calc(100vw - 24px));padding:8px 11px;border:1px solid #e6d5b2;border-radius:6px;background:#fffbef;color:#755422;box-shadow:0 4px 16px #23334d18;font-size:12px;line-height:1.6;overflow-wrap:anywhere}
.intake-menu{z-index:2050;display:flex;flex-direction:column;gap:7px;width:max-content;max-width:min(360px,calc(100vw - 24px));max-height:var(--reka-popover-content-available-height);overflow:auto;padding:10px;border:1px solid #dce4ee;border-radius:7px;background:white;box-shadow:0 6px 22px #23334d20}
.intake-menu button{font-size:12px;padding:6px 10px;min-height:30px}
</style>

<script setup>
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui';
import { computed, ref, watch } from 'vue';
import { suggestedEvidenceKind } from '../lib/payment-attachments.js';
import { coveredTruncatedTransactions, reconcileEvidenceTransactions } from '../lib/payment-transactions.js';
import EvidenceDocument from './EvidenceDocument.vue';
import EvidenceThumbnail from './EvidenceThumbnail.vue';

const props = defineProps({ item: Object, files: Array, modelValue: Array });
const emit = defineEmits(['update:modelValue']);
const showAll = ref(false), active = ref(-1);
const choices = computed(() => {
  const hints = new Map(props.item.candidates.map(candidate => [candidate.file.file, candidate.hint]));
  return props.files.map((candidate, index) => ({ candidate, index, hint: hints.get(candidate.file), choice: props.modelValue.find(selection => selection.index === index) })).filter(item => showAll.value || item.hint || item.choice);
});
const current = computed(() => choices.value.find(item => item.index === active.value) || choices.value[0]);
const stage = computed(() => props.item.record.recordType === '阶段汇总');
function transactions(candidate) { return candidate?.transactions?.length ? candidate.transactions.map(item => item.fields || item) : [candidate?.fields || {}]; }
const selectedTransactions = computed(() => props.modelValue.filter(selection => selection.kind === '付款凭证').flatMap(selection => transactions(props.files[selection.index]).map((fields, index) => ({ index, fileIndex: selection.index, fields })).filter(item => !selection.omit.includes(item.index))));
const result = computed(() => reconcileEvidenceTransactions(selectedTransactions.value, props.item.record.total, props.item.record.dateRange));
const currentTransactions = computed(() => transactions(current.value?.candidate));
const covered = computed(() => coveredTruncatedTransactions(currentTransactions.value, selectedTransactions.value.map(item => item.fields)));
const amountText = value => value === '' || value == null || !Number.isFinite(Number(value)) ? '—' : `¥${Number(value).toFixed(2)}`;
function setChoice(index, value) {
  const next = props.modelValue.filter(selection => selection.index !== index);
  if (value) next.push(value);
  const corroborating = next.filter(selection => selection.kind === '付款凭证').flatMap(selection => transactions(props.files[selection.index]).filter((fields, position) => fields.complete && !selection.omit.includes(position)));
  emit('update:modelValue', stage.value ? next.map(selection => {
    const overlap = coveredTruncatedTransactions(transactions(props.files[selection.index]), corroborating);
    const manual = selection.manual || {};
    return { ...selection, omit: transactions(props.files[selection.index]).flatMap((_, position) => (manual[position] ?? overlap.has(position)) ? [position] : []) };
  }) : next);
}
function check(index, candidate, yes) {
  setChoice(index, yes ? { index, kind: suggestedEvidenceKind(candidate), omit: [] } : null);
}
function countTransaction(choice, index, yes) {
  setChoice(choice.index, { ...choice, manual: { ...choice.manual, [index]: !yes }, omit: yes ? choice.omit.filter(value => value !== index) : [...new Set([...choice.omit, index])] });
}
watch(showAll, () => { if (!choices.value.some(item => item.index === active.value)) active.value = -1; });
</script>

<template>
  <DialogRoot v-if="files.length">
    <DialogTrigger class="ui-btn-sm">{{ item.candidates.length }} 份候选 · 已选 {{ modelValue.length }}</DialogTrigger>
    <DialogPortal><DialogOverlay class="print-layout-overlay" />
      <DialogContent class="print-layout-modal payment-candidate-dialog">
        <header class="print-layout-header"><div><DialogTitle class="print-layout-title">付款凭证截图核对</DialogTitle><DialogDescription class="print-layout-description">{{ item.record.seller || '收款方未知' }} · {{ item.record.date || item.record.dateRange || '日期未知' }}</DialogDescription></div><DialogClose class="ui-btn">完成</DialogClose></header>
        <div class="flex flex-wrap items-center gap-3 border-b border-line bg-surface p-3"><span>清单 <b class="ui-money">{{ amountText(item.record.total) }}</b></span><template v-if="stage"><span>已核实 <b class="ui-money">{{ amountText(result.total) }}</b></span><span v-if="item.record.total !== ''">差额 <b>{{ amountText(result.total - Number(item.record.total)) }}</b></span><span :class="result.matches ? 'ui-badge-ok' : 'ui-badge-warn'">{{ result.matches ? '已平账' : '待核对' }}</span></template><label class="ml-auto flex items-center gap-1"><input v-model="showAll" type="checkbox" /> 全部已读文件</label></div>
        <div class="flex shrink-0 gap-2 overflow-auto border-b border-line p-3" aria-label="凭证缩略图画廊">
          <button v-for="{ candidate, index, choice } in choices" :key="index" class="ui-focus w-35 shrink-0 rounded-md border border-line bg-panel p-2 text-left hover:bg-surface" :class="{ 'border-brand bg-brand-soft': current?.index === index }" :aria-pressed="current?.index === index" :title="candidate.file.webkitRelativePath || candidate.file.name" @click="active = index">
            <EvidenceThumbnail :file="candidate.file" /><span class="block truncate text-xs">{{ candidate.file.name }}</span><span :class="candidate.duplicateHint ? 'ui-badge-warn' : choice ? 'ui-badge-ok' : 'ui-badge-neutral'">{{ candidate.duplicateHint ? '疑似重复' : choice?.kind || suggestedEvidenceKind(candidate) }}</span>
          </button>
          <p v-if="!choices.length" class="text-xs text-ink-soft">暂无自动候选，可勾选“全部已读文件”。</p>
        </div>
        <div v-if="current" class="candidate-body">
          <section class="overflow-auto p-3"><EvidenceDocument :file="current.candidate.file" /></section>
          <section class="overflow-auto p-3" aria-label="识别摘要">
            <label class="mb-2 flex items-center gap-2"><input type="checkbox" :checked="!!current.choice" @change="check(current.index, current.candidate, $event.target.checked)" /> 关联这份凭证</label>
            <p class="break-words text-xs text-ink-secondary">{{ current.choice?.reason || current.hint || '手动选择' }}</p>
            <dl class="ui-section my-2 grid gap-1 text-xs"><dt>收款方</dt><dd>{{ current.candidate.fields?.seller || '未知' }}</dd><dt>金额</dt><dd>{{ amountText(current.candidate.fields?.total) }}</dd><dt>付款留言</dt><dd>{{ current.candidate.fields?.message || '未识别' }}</dd><dt>交易号 / 订单号</dt><dd class="break-all">{{ current.candidate.fields?.transactionId || current.candidate.fields?.orderId || '未识别' }}</dd></dl>
            <label v-if="current.choice" class="ui-label">保存为<select class="ui-input" :value="current.choice.kind" :disabled="current.candidate.fields?.kind === 'order'" @change="setChoice(current.index, { ...current.choice, kind: $event.target.value })"><option>付款凭证</option><option>订单详情</option><option>其他附件</option></select></label>
            <div v-if="stage && current.choice?.kind === '付款凭证'" class="mt-3 grid gap-2"><h3 class="font-semibold">阶段汇总 · 逐笔交易</h3><label v-for="(transaction, index) in currentTransactions" :key="index" class="flex items-start gap-2 border-t border-line pt-2"><input type="checkbox" :checked="!current.choice.omit.includes(index)" @change="countTransaction(current.choice, index, $event.target.checked)" /><span>{{ transaction.date || '日期未知' }} · {{ amountText(transaction.total) }}<br><small class="break-all">{{ transaction.transactionId || transaction.orderId || '单号未知' }}</small><span v-if="covered.has(index)" class="ml-1 ui-badge-warn">疑似重叠</span></span></label></div>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot><span v-else>—</span>
</template>

<style scoped>
.payment-candidate-dialog { width:min(1100px,96vw); height:min(760px,92dvh); text-align:left; white-space:normal; }
.candidate-body { display:grid; grid-template-columns:minmax(0, 1.45fr) minmax(245px, 1fr); flex:1; min-height:0; }
@media (max-width:650px) { .candidate-body { display:block; overflow:auto; } }
</style>

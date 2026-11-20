<script setup>
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { computed, shallowRef, watch } from 'vue';
import { invoiceActions, invoiceStore } from '../invoiceStore.js';
import { getLedgerAttachment } from '../lib/ledger-attachments.js';
import { supplementInvoiceCandidates, searchSupplementInvoices } from '../lib/invoice-supplements.js';
import { useConfirmation } from '../composables/useConfirmation.js';
import ConfirmAction from './ConfirmAction.vue';
import EvidenceDocument from './EvidenceDocument.vue';

const selected = shallowRef(''), message = shallowRef(''), query = shallowRef(''), original = shallowRef(null);
const record = computed(() => invoiceStore.supplements.find(item => item.hash === invoiceStore.matchSupplementHash));
const candidates = computed(() => record.value ? supplementInvoiceCandidates(record.value, invoiceStore.ledger) : []);
const ranks = computed(() => new Map(candidates.value.map((item, index) => [item.entry.key, { index, ...item }])));
const results = computed(() => searchSupplementInvoices(invoiceStore.ledger, query.value).sort((first, second) => (ranks.value.get(first.key)?.index ?? Infinity) - (ranks.value.get(second.key)?.index ?? Infinity)));
const chosen = computed(() => selected.value && invoiceStore.ledger[selected.value]);
const current = computed(() => record.value?.ledgerKey && invoiceStore.ledger[record.value.ledgerKey]);
const queue = computed(() => [...invoiceStore.supplements].sort((first, second) => Number(!!first.ledgerKey) - Number(!!second.ledgerKey)));
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
function close() { invoiceStore.matchSupplementHash = ''; }
watch(() => invoiceStore.matchSupplementHash, async (hash, _, onCleanup) => {
  let stale = false;
  onCleanup(() => { stale = true; });
  selected.value = ''; query.value = ''; message.value = ''; original.value = null;
  if (!hash) return;
  try {
    const attachment = await getLedgerAttachment('supplement:' + hash);
    if (!stale) original.value = attachment?.blob || null;
  } catch (error) { if (!stale) message.value = error.message; }
});
async function link() {
  try { await invoiceActions.confirmSupplementLink(record.value.hash, selected.value); message.value = '已关联主票。'; }
  catch (error) { message.value = error.message; }
}
async function unlink() {
  const hash = record.value.hash;
  if (!await requestConfirmation('解除附件关联', '将附件移回待匹配队列，原件仍保留。', '解除关联')) return;
  try { invoiceActions.unlinkSupplement(hash); message.value = '已解除关联，原件仍保留。'; }
  catch (error) { message.value = error.message; }
}
async function retry() {
  try { const result = await invoiceActions.retrySupplementMatches(); message.value = `已关联 ${result.linked} 份，仍待匹配 ${result.pending} 份${result.failed ? `，失败 ${result.failed} 份` : ''}。`; }
  catch (error) { message.value = error.message; }
}
</script>

<template>
  <DialogRoot :open="!!record" @update:open="open => { if (!open) close(); }">
    <DialogPortal><DialogOverlay class="print-layout-overlay" />
      <DialogContent class="print-layout-modal supplement-workbench" @interact-outside.prevent>
        <header class="print-layout-header"><div><DialogTitle class="print-layout-title">附件与主票对照关联</DialogTitle><DialogDescription class="print-layout-description">附件单独保留，不计入主票金额。关联信息会同步到历史台账。</DialogDescription></div><DialogClose class="ui-btn">关闭</DialogClose></header>
        <div class="flex items-center gap-2 border-b border-line p-3"><div class="flex flex-1 gap-2 overflow-auto" aria-label="附件队列"><button v-for="item in queue" :key="item.hash" class="ui-btn" :class="{ 'bg-brand-soft': item.hash === record?.hash }" :aria-pressed="item.hash === record?.hash" :title="item.relativePath || item.name" @click="invoiceStore.matchSupplementHash = item.hash"><span class="max-w-45 truncate">{{ item.name }}</span><span :class="item.ledgerKey ? 'ui-badge-ok' : 'ui-badge-warn'">{{ item.ledgerKey ? '已关联' : '待匹配' }}</span></button></div><button class="ui-btn" :disabled="invoiceStore.savingIntake" @click="retry">重新自动匹配</button></div>
        <div class="supplement-columns">
          <section class="overflow-auto p-3" aria-label="附件预览">
            <h3 class="mb-2 font-semibold">附件原件</h3><EvidenceDocument :file="original" />
            <dl v-if="record" class="ui-section mt-3 grid gap-1 text-xs"><dt class="text-ink-soft">相对路径</dt><dd class="break-all">{{ record.relativePath || record.name }}</dd><dt class="text-ink-soft">识别摘要</dt><dd>{{ [record.fields.seller, record.fields.date, record.fields.total === '' || record.fields.total == null ? '' : `¥${record.fields.total}`].filter(Boolean).join(' · ') || '无摘要' }}</dd></dl>
          </section>
          <section class="flex min-h-0 flex-col gap-2 p-3" aria-label="候选主票">
            <label class="ui-label">搜索主票<input v-model="query" type="search" class="ui-input" placeholder="票号、公司、日期或金额" @input="selected = ''" /></label>
            <p class="text-xs text-ink-secondary">{{ current ? `已关联：${current.number || current.key} · ${current.seller || ''}` : `找到 ${results.length} 张主票${results.length > 60 ? '，显示前 60 张' : ''}` }}</p>
            <div class="min-h-0 flex-1 overflow-auto rounded-md border border-line">
              <label v-for="entry in results.slice(0, 60)" :key="entry.key" class="flex cursor-pointer items-start gap-2 border-b border-line px-3 py-2 hover:bg-surface"><input v-model="selected" type="radio" :value="entry.key" :disabled="!!record?.ledgerKey" /><span class="min-w-0 break-words"><strong>{{ entry.number || entry.key }}</strong> · {{ entry.date || '日期未知' }} · ¥{{ entry.total ?? '—' }}<br>{{ entry.seller || '销售方未知' }} → {{ entry.buyer || '购买方未知' }}<br><small :class="ranks.get(entry.key)?.conflict ? 'ui-badge-warn' : ranks.get(entry.key)?.strong ? 'ui-badge-ok' : 'ui-badge-neutral'">{{ ranks.get(entry.key)?.hint || '手动选择' }}</small></span></label>
              <p v-if="!results.length" class="work-empty">没有匹配主票。请调整搜索条件，或先将主票保存到台账。</p>
            </div>
            <p v-if="message" class="text-xs text-ink-secondary" role="status">{{ message }}</p>
            <button v-if="record?.ledgerKey" class="ui-btn-danger self-end" :disabled="invoiceStore.savingIntake" @click="unlink">解除当前关联</button>
            <button v-else class="ui-btn-primary self-end" :disabled="!chosen || invoiceStore.savingIntake" @click="link">确认关联</button>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
</template>

<style scoped>
.supplement-workbench { width:min(1080px, 96vw); height:min(760px, 92dvh); font-size:13px; }
.supplement-columns { display:grid; grid-template-columns:minmax(0, 1fr) minmax(0, 1fr); flex:1; min-height:0; }
.supplement-columns > :first-child { border-right:1px solid #e3e6ea; background:#f5f6f8; }
@media(max-width:650px) { .supplement-columns { display:block; overflow:auto; } .supplement-columns > section { max-height:58dvh; } }
</style>

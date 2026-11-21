<script setup>
import UiDisclosure from './UiDisclosure.vue';
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { getLedgerAttachment } from '../lib/ledger-attachments.js';
import { buildPrintLayout, openForPrint } from '../lib/invoice-layout.js';
import { renderPdfPages } from '../lib/pdftext.js';
import { downloadBytes } from '../lib/file-utils.js';
import { invoiceStore } from '../invoiceStore.js';

const props = defineProps({ entries: { type: Array, required: true } });
const emit = defineEmits(['close']);
const perPage = ref(invoiceStore.perPage);
const files = shallowRef(null), missing = ref([]), skipped = ref([]);
const output = shallowRef(null), pages = ref(0), page = ref(1);
const image = ref(''), notice = ref(''), loading = ref(true);
let alive = true;
onUnmounted(() => { alive = false; });
onMounted(async () => {
  const originals = [], unavailable = [];
  for (const entry of props.entries) {
    if (!alive) return;
    try {
      const original = await getLedgerAttachment(entry.key);
      if (original?.blob) { originals.push({ name: original.name || original.blob.name, blob: original.blob, rotation: entry.rotation || 0 }); continue; }
      unavailable.push(entry.number || entry.key);
    } catch { unavailable.push(entry.number || entry.key); }
  }
  if (alive) { missing.value = unavailable; files.value = originals; }
});
watch([files, perPage], async ([originals, count], _, onCleanup) => {
  let active = true;
  onCleanup(() => { active = false; });
  output.value = null; pages.value = 0; page.value = 1; skipped.value = []; notice.value = '';
  if (!originals) return;
  loading.value = true;
  try {
    if (!originals.length) return;
    let layout;
    const bytes = await buildPrintLayout(originals, { perPage: count, onLayout: info => { layout = info; } });
    if (!active) return;
    skipped.value = layout.skipped;
    if (layout.pages) { pages.value = layout.pages; output.value = bytes; }
  } catch (error) { if (active) notice.value = '排版失败：' + error.message; }
  finally { if (active) loading.value = false; }
});
watch([output, page], async ([bytes, number], _, onCleanup) => {
  let active = true, url = '';
  onCleanup(() => { active = false; if (url) URL.revokeObjectURL(url); });
  image.value = ''; notice.value = '';
  if (!bytes) return;
  try {
    const [result] = await renderPdfPages(new Blob([bytes], {type:'application/pdf'}), { firstPage: number, maxPages: 1, scale: 1.3 });
    if (!active) { if (result) URL.revokeObjectURL(result); return; }
    url = result;
    if (url) image.value = url;
    else notice.value = '本页无法显示，请核对原件。';
  } catch (error) { if (active) notice.value = '预览失败：' + error.message; }
});
</script>
<template>
  <DialogRoot :open="true" @update:open="value => { if (!value) emit('close') }"><DialogPortal>
    <DialogOverlay class="print-layout-overlay" />
    <DialogContent class="print-layout-modal ledger-print">
      <header class="print-layout-header"><div><DialogTitle class="print-layout-title">所选发票打印预览</DialogTitle>
        <DialogDescription>已选 {{ entries.length }} 张<span v-if="files">，可打印 {{ files.length - skipped.length }} 张</span></DialogDescription>
      </div><DialogClose class="btn">关闭</DialogClose></header>
      <div class="ledger-print-tools">
        <label>排版 <select v-model.number="perPage"><option v-for="n in [1,2,4]" :key="n" :value="n">每页 {{ n }} 张</option></select></label>
        <button class="btn" :disabled="page <= 1" @click="page--">上一页</button>
        <span aria-live="polite">{{ pages ? page + ' / ' + pages + ' 页' : '—' }}</span>
        <button class="btn" :disabled="page >= pages" @click="page++">下一页</button>
        <button class="ui-btn" :disabled="!output" @click="downloadBytes(output, '历史进项台账-合并排版.pdf')">导出合并 PDF</button>
        <button class="ui-btn-primary" :disabled="!output || !image" @click="openForPrint(output)">打印 {{ files ? files.length - skipped.length : 0 }} 张发票</button>
      </div>
      <UiDisclosure v-if="missing.length || skipped.length" class="ledger-print-warning"><template #label>有 {{ missing.length + skipped.length }} 张未排入打印，查看原因</template>
        <p v-if="missing.length">缺少可读取的发票原件（可在详情中补传）：{{ missing.join('、') }}</p>
        <p v-if="skipped.length">无法排版的文件：{{ skipped.join('、') }}</p>
      </UiDisclosure>
      <div class="ledger-print-paper" aria-live="polite"><img v-if="image" :src="image" :alt="'打印排版第 '+page+' 页'" />
        <p v-else>{{ notice || (loading || output ? '正在生成打印预览…' : '所选发票均无可打印的原件。') }}</p></div>
    </DialogContent>
  </DialogPortal></DialogRoot>
</template>
<style scoped>
.ledger-print{display:flex;flex-direction:column;overflow:hidden}
.ledger-print-tools{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;padding:.65rem 1rem}
.ledger-print-tools label{display:flex;align-items:center;gap:.4rem}
.ledger-print-warning{padding:.5rem 1rem;color:#81520f;background:#fff8e8;overflow:auto;max-height:22vh;overflow-wrap:anywhere}
.ledger-print-paper{flex:1;min-height:0;overflow:auto;background:#e9edf2;padding:1rem;text-align:center}
.ledger-print-paper img{display:block;margin:0 auto;width:auto;max-width:100%;height:auto;box-shadow:0 1px 8px #19283b33}
</style>

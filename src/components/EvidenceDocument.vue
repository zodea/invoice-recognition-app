<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { isPdf } from '../lib/file-utils.js';
import { createPreviewPan } from '../lib/preview-pan.js';

const props = defineProps({ file: Object });
const urls = ref([]), index = ref(0), zoom = ref(100), viewport = ref(null), dragging = ref(false), notice = ref('');
const pan = createPreviewPan(() => viewport.value, value => { dragging.value = value; });
const current = computed(() => urls.value[index.value]);
function reset() { zoom.value = 100; viewport.value?.scrollTo(0, 0); }
function step(delta) { zoom.value = Math.max(100, Math.min(400, zoom.value + delta)); }
function wheel(event) { if (event.ctrlKey || event.metaKey) { event.preventDefault(); step(event.deltaY < 0 ? 25 : -25); } }
watch(() => props.file, async (file, _, onCleanup) => {
  let stale = false, loaded = [];
  onCleanup(() => { stale = true; loaded.forEach(url => URL.revokeObjectURL(url)); });
  urls.value = []; index.value = 0; pan.cancel(); reset();
  notice.value = file ? '正在读取原件…' : '请选择原件';
  if (!file) return;
  try {
    if (isPdf(file)) {
      const { renderPdfPages } = await import('../lib/pdftext.js');
      loaded = await renderPdfPages(file, { maxPages: 20, scale: 1.4, maxPixels: 360000 });
    } else {
      loaded = [URL.createObjectURL(file)];
    }
    if (stale) { loaded.forEach(url => URL.revokeObjectURL(url)); return; }
    urls.value = loaded;
    notice.value = loaded.length ? '' : '没有可预览的页面';
  } catch (error) { if (!stale) notice.value = `预览失败：${error.message || error}`; }
}, { immediate: true });
onBeforeUnmount(pan.cancel);
</script>

<template>
  <section class="evidence-document" aria-label="原件画布">
    <div v-if="current" class="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel px-2 py-1">
      <button class="ui-btn-sm" aria-label="缩小原件" @click="step(-25)">−</button><button class="ui-btn-sm" title="重置缩放和平移" @click="reset">{{ zoom }}%</button><button class="ui-btn-sm" aria-label="放大原件" @click="step(25)">＋</button>
      <template v-if="urls.length > 1"><button class="ui-btn-sm" :disabled="index === 0" @click="index--; reset()">上一页</button><span>{{ index + 1 }} / {{ urls.length }}</span><button class="ui-btn-sm" :disabled="index + 1 === urls.length" @click="index++; reset()">下一页</button></template>
    </div>
    <div ref="viewport" class="document-canvas evidence-viewport" :class="{ 'can-pan': current, dragging }" @wheel="wheel" @pointerdown="pan.down" @pointermove="pan.move" @pointerup="pan.up" @pointercancel="pan.up" @lostpointercapture="pan.up">
      <DocumentImage v-if="current" :file="file" :src="current" :page-number="index + 1" :alt="file.name || '凭证原件'" :style="{ width: `${zoom}%` }" draggable="false" @dragstart.prevent />
      <p v-else class="work-empty" role="status">{{ notice }}</p>
    </div>
  </section>
</template>

<style scoped>
.evidence-document { min-width: 0; overflow: hidden; border: 1px solid #e3e6ea; border-radius: 7px; }
.evidence-viewport { min-height: 180px; max-height: 55dvh; }
.evidence-viewport img { margin-block: 0; }
</style>

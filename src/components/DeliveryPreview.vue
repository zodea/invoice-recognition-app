<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createPreviewPan } from '../lib/preview-pan.js';

const props = defineProps({ file: Object });
const page = ref(0), zoom = ref(100), viewport = ref(null), dragging = ref(false);
const pan = createPreviewPan(() => viewport.value, value => { dragging.value = value; });
const pages = computed(() => props.file.pages || []);
const src = computed(() => pages.value[page.value]?.dataUrl);
watch(() => pages.value.length, count => { page.value = Math.min(page.value, Math.max(0, count - 1)); });
watch(page, resetZoom);
function changeZoom(delta) { zoom.value = Math.max(100, Math.min(400, zoom.value + delta)); }
function resetZoom() { zoom.value = 100; viewport.value?.scrollTo(0, 0); }
function onWheel(event) {
  if (!(event.ctrlKey || event.metaKey) || !src.value) return;
  event.preventDefault();
  changeZoom(event.deltaY < 0 ? 25 : -25);
}
onBeforeUnmount(pan.cancel);
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-col bg-surface" aria-label="送货单原图">
    <header class="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-panel px-2.5 py-1.5">
      <h3 class="mr-auto text-xs font-semibold">送货单原图</h3>
      <template v-if="pages.length">
        <button class="ui-btn-sm" type="button" aria-label="缩小送货单" :disabled="zoom <= 100" @click="changeZoom(-25)">−</button>
        <button class="ui-btn-sm ui-money" type="button" aria-label="重置送货单缩放" @click="resetZoom">{{ zoom }}%</button>
        <button class="ui-btn-sm" type="button" aria-label="放大送货单" :disabled="zoom >= 400" @click="changeZoom(25)">＋</button>
        <template v-if="pages.length > 1">
          <button class="ui-btn-sm" :disabled="page === 0" type="button" aria-label="送货单上一页" @click="page--">‹</button>
          <span class="ui-money text-xs">{{ page + 1 }} / {{ pages.length }}</span>
          <button class="ui-btn-sm" :disabled="page === pages.length - 1" type="button" aria-label="送货单下一页" @click="page++">›</button>
        </template>
      </template>
    </header>
    <div ref="viewport" class="delivery-preview-canvas flex-1 overflow-auto" :class="{ 'can-pan': src, dragging }" tabindex="0"
      aria-label="送货单原图预览，拖动平移，Ctrl 加滚轮缩放"
      @pointerdown="src && pan.down($event)" @pointermove="pan.move" @pointerup="pan.up" @pointercancel="pan.up" @lostpointercapture="pan.up" @wheel="onWheel">
      <div v-if="src" :style="{ width: zoom + '%' }" class="mx-auto p-2">
        <DocumentImage :file="file.blob" :name="file.name" :src="src" :page-number="page + 1" :alt="'送货单原图第 ' + (page + 1) + ' 页'" class="block w-full bg-panel" draggable="false" />
      </div>
      <div v-else class="grid h-full min-h-22 place-items-center p-3 text-center text-xs text-ink-secondary" role="status">{{ file.rendering ? '正在读取原图…' : file.renderError || '暂无原图预览' }}</div>
    </div>
  </section>
</template>

<style scoped>
.delivery-preview-canvas.can-pan { cursor:grab; touch-action:none; }
.delivery-preview-canvas.dragging { cursor:grabbing; user-select:none; }
</style>

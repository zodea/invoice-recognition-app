<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { isPdf } from '../lib/file-utils.js';
import { acquirePreview, previewKey } from '../lib/preview-cache.js';

const props = defineProps({
  file: Object,
  name: String,
  src: String,
  pageNumber: { type: Number, default: 1 },
  rotation: { type: Number, default: 0 },
  alt: String,
});
const element = ref(null);
const highResolution = ref('');
const width = ref(0);
const pixelRatio = ref(1);
const visible = ref(false);
const aspectRatio = ref('');
let generation = 0, timer, observer, visibilityObserver;
let renderedWidth = 0;

let currentPage;
function release() {
  currentPage?.release();
  currentPage = null;
  highResolution.value = '';
  renderedWidth = 0;
}
function measure() {
  width.value = element.value?.getBoundingClientRect().width || 0;
  pixelRatio.value = window.devicePixelRatio || 1;
}
watch([() => props.file, () => props.name, () => props.pageNumber, () => props.rotation, width, pixelRatio, visible], (current, previous = []) => {
  const request = ++generation;
  clearTimeout(timer);
  if (current.slice(0, 4).some((value, index) => value !== previous[index])) { release(); aspectRatio.value = ''; }
  if (!visible.value) { release(); return; }
  if (!props.file || !width.value || !isPdf({ name: props.name, blob: props.file })) return;
  // 合并连续缩放；已生成的高清图在缩小时继续复用。
  const targetWidth = Math.ceil(width.value * pixelRatio.value / 256) * 256;
  if (targetWidth <= renderedWidth) return;
  timer = setTimeout(async () => {
    try {
      const { file, pageNumber, rotation } = props;
      const key = previewKey(file, pageNumber, rotation, targetWidth);
      const page = await acquirePreview(key, async () => {
        const { renderPdfPages } = await import('../lib/pdftext.js');
        const [url] = await renderPdfPages(file, { firstPage: pageNumber, maxPages: 1, targetWidth, rotation });
        if (!url) return '';
        const decoded = new Image();
        decoded.src = url;
        try { await decoded.decode(); }
        catch (error) { URL.revokeObjectURL(url); throw error; }
        return url;
      });
      if (request !== generation) { page.release(); return; }
      const previousPage = currentPage;
      currentPage = page;
      highResolution.value = page.url;
      renderedWidth = targetWidth;
      previousPage?.release();
    } catch { /* 高清渲染失败时继续显示已有原图 */ }
  }, 150);
});

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  observer.observe(element.value);
  visibilityObserver = new IntersectionObserver(([entry]) => { visible.value = entry.isIntersecting; }, { rootMargin: '200px' });
  visibilityObserver.observe(element.value);
  window.addEventListener('resize', measure);
});
onBeforeUnmount(() => {
  generation++;
  clearTimeout(timer);
  observer?.disconnect();
  visibilityObserver?.disconnect();
  window.removeEventListener('resize', measure);
  release();
});
</script>

<template>
  <img ref="element" :src="highResolution || src || undefined" :alt="alt" decoding="async" :style="aspectRatio ? { aspectRatio } : undefined" @load="event => { if (!aspectRatio && event.target.naturalWidth) aspectRatio = `${event.target.naturalWidth} / ${event.target.naturalHeight}`; }" />
</template>

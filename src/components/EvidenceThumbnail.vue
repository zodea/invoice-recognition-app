<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { isPdf } from '../lib/file-utils.js';
const props = defineProps({ file: Object });
const frame = ref(null);
const visible = ref(false);
const source = ref('');
let observer;
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => { visible.value = entry.isIntersecting; }, { rootMargin: '160px' });
  observer.observe(frame.value);
});
onBeforeUnmount(() => observer?.disconnect());
watch([() => props.file, visible], async ([file, shown], _, onCleanup) => {
  let stale = false, url = '';
  onCleanup(() => { stale = true; if (url) URL.revokeObjectURL(url); });
  source.value = '';
  if (!shown || !file || isPdf(file)) return;
  let bitmap, canvas;
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: 160, resizeQuality: 'medium' });
    if (stale) return;
    canvas = document.createElement('canvas');
    canvas.height = Math.min(bitmap.height, 320);
    canvas.width = Math.max(1, Math.round(bitmap.width * canvas.height / bitmap.height));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!stale) url = URL.createObjectURL(blob || file);
  } catch { if (!stale) url = URL.createObjectURL(file); }
  finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
  if (!stale) source.value = url;
});
</script>
<template>
  <span ref="frame" class="inline-grid h-13 w-19 place-items-center overflow-hidden rounded border border-line bg-surface">
    <img v-if="source" :src="source" class="h-full w-full object-contain" alt="" loading="lazy" decoding="async" />
    <span v-else-if="file && isPdf(file)" class="ui-badge-neutral" aria-hidden="true">PDF</span>
  </span>
</template>

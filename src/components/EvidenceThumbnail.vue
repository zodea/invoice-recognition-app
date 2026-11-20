<script setup>
import { ref, watch } from 'vue';
import { isPdf } from '../lib/file-utils.js';
const props = defineProps({ file: Object });
const source = ref('');
watch(() => props.file, (file, _, onCleanup) => {
  source.value = '';
  if (!file || isPdf(file)) return;
  const url = URL.createObjectURL(file);
  onCleanup(() => URL.revokeObjectURL(url));
  source.value = url;
}, { immediate: true });
</script>
<template>
  <img v-if="source" :src="source" class="h-13 w-19 rounded border border-line bg-surface object-contain" alt="" loading="lazy" />
  <span v-else class="ui-badge-neutral" aria-hidden="true">PDF</span>
</template>

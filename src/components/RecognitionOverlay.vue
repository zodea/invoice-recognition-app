<script setup>
import { computed } from 'vue';
import { keyFieldRegions } from '../lib/recognition-regions.js';
const props = defineProps({ fields: Object, regions: Array, page: Number, rotation: Number });
const boxes = computed(() => keyFieldRegions(props.fields, props.regions, props.page, props.rotation));
</script>

<template>
  <svg class="recognition-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" :aria-label="`已定位 ${boxes.length} 个关键字段区域`">
    <rect v-for="(box, index) in boxes" :key="index" :x="box.x * 1000" :y="box.y * 1000" :width="box.width * 1000" :height="box.height * 1000" vector-effect="non-scaling-stroke">
      <title>{{ box.label }}：{{ box.value }}&#10;识别文本：{{ box.text }}</title>
    </rect>
  </svg>
</template>

<style scoped>
.recognition-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.recognition-overlay rect { fill: #2563eb12; stroke: #2563eb; stroke-width: 1.5px; pointer-events: auto; }
</style>

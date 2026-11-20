<script setup>
defineProps({ status: Object });
const tones = { neutral: 'ui-badge-neutral', brand: 'ui-badge-brand', ok: 'ui-badge-ok', warn: 'ui-badge-warn', danger: 'ui-badge-danger' };
</script>

<template>
  <span v-if="status" :class="tones[status.tone]">{{ status.label }}</span>
</template>

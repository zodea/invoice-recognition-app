<script setup>
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { toChineseUpper } from '../lib/chinese-money.js';

defineProps({ label: String });
const value = defineModel({ default: '' });
const anchor = useTemplateRef('anchor');
const tooltip = useTemplateRef('tooltip');
const visible = ref(false);
const position = ref({});
const upper = computed(() => toChineseUpper(value.value));
async function show() {
  if (!upper.value) return;
  visible.value = true;
  await nextTick();
  if (!anchor.value || !tooltip.value) return;
  const rect = anchor.value.getBoundingClientRect();
  const { offsetWidth, offsetHeight } = tooltip.value;
  position.value = { left: `${Math.max(8, Math.min(rect.left, window.innerWidth - offsetWidth - 8))}px`, top: `${rect.top - offsetHeight - 6 >= 8 ? rect.top - offsetHeight - 6 : rect.bottom + 6}px` };
}
</script>

<template>
  <label class="ui-label">{{ label }}<input ref="anchor" v-model="value" class="ui-input ui-money" inputmode="decimal" @mouseenter="show" @mouseleave="visible = false" /></label>
  <Teleport to="body"><div v-if="visible && upper" ref="tooltip" role="tooltip" class="money-tooltip rounded-md bg-ink px-2 py-1 text-xs text-white" :style="position">{{ upper }}</div></Teleport>
</template>

<style scoped>
.money-tooltip { position:fixed; z-index:100; pointer-events:none; max-width:calc(100vw - 16px); }
</style>

<script setup>
import { toast, toastError } from '../lib/toast.js';
const props = defineProps({ value: String });
async function copy() {
  try { await navigator.clipboard.writeText(props.value); toast('已复制完整单号'); }
  catch { toastError('复制失败，请选择完整单号复制'); }
}
</script>

<template>
  <span v-if="value" class="inline-flex max-w-full min-w-0 items-center gap-1"><MiddleEllipsis :text="value" :tail="8" /><button type="button" class="ui-btn-sm shrink-0" aria-label="复制完整单号" @click="copy">复制</button></span>
  <span v-else>未识别</span>
</template>

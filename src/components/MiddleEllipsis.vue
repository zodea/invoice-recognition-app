<script setup>
import { computed } from "vue";

const props = defineProps({ text: { type: String, default: "" }, tail: { type: Number, default: 4 } });
const parts = computed(() => {
  const chars = Array.from(props.text);
  if (chars.length <= props.tail) return [props.text, ""];
  return [chars.slice(0, -props.tail).join(""), chars.slice(-props.tail).join("")];
});
</script>

<template>
  <span class="middle-ellipsis" :title="text" :aria-label="text"><span class="middle-ellipsis-start">{{ parts[0] }}</span><span class="middle-ellipsis-end">{{ parts[1] }}</span></span>
</template>

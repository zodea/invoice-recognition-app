<script setup>
import { toastState, dismissToast } from "../lib/toast";

const accent = { success: "border-ok", error: "border-danger", info: "border-brand", warn: "border-warn" };
const iconColor = { success: "text-ok", error: "text-danger", info: "text-brand", warn: "text-warn" };
const icon = { success: "✓", error: "✕", info: "ℹ", warn: "!" };
</script>

<template>
  <div class="fixed z-[1000] bottom-5 right-5 flex flex-col gap-2 w-90 max-w-[92vw] pointer-events-none">
    <TransitionGroup name="toast">
      <div
        v-for="t in toastState.items"
        :key="t.id"
        class="pointer-events-auto bg-white rounded-card shadow-pop border-l-4 px-3.5 py-2.75 flex items-start gap-2.5 text-sm text-ink"
        :class="accent[t.type] || 'border-brand'"
      >
        <span class="flex-none font-700 leading-5" :class="iconColor[t.type] || 'text-brand'">{{ icon[t.type] || "ℹ" }}</span>
        <span class="flex-1 min-w-0 whitespace-pre-wrap break-words leading-5">{{ t.message }}</span>
        <button class="flex-none text-ink-soft hover:text-ink leading-5" @click="dismissToast(t.id)" aria-label="关闭">✕</button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
.toast-leave-active {
  position: absolute;
  right: 0;
  width: 100%;
}
</style>

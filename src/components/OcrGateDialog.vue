<script setup>
// OCR 拦截弹窗（issue #13）：未配置云识别时点识别先弹这个，
// 让用户去配置，或确认"仍用本地（以后别再问）"。
import { computed } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { store, actions } from "../store";
import { openSettings } from "../lib/ui";

const open = computed({
  get: () => store.ocrGate.open,
  set: (v) => { if (!v) actions.cancelOcrGate(); },
});

function goConfigure() {
  actions.cancelOcrGate();
  openSettings();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="open = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="fixed z-51 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(460px,92vw)] bg-bg rounded-card shadow-pop p-4 outline-none"
      >
        <DialogTitle class="m-0 text-base font-700">还没配置云识别</DialogTitle>
        <DialogDescription class="mt-2 text-[13px] text-ink leading-relaxed">
          手写送货单、表格明细只有<b>云端 PaddleOCR-VL</b> 能可靠识别。当前未配置，将退回<b>本地小模型</b>（仅印刷体），手写/表格明细很可能识别不出。
        </DialogDescription>
        <div class="mt-4 flex items-center justify-end gap-2 flex-wrap">
          <button class="btn px-3 py-1.5" @click="actions.proceedLocalOcr()">仍用本地，以后别再问</button>
          <button class="btn-primary px-3 py-1.5" @click="goConfigure">去配置</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

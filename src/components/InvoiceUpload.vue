<script setup>
import { ref } from "vue";
import { invoiceActions } from "../invoiceStore";

const dragging = ref(false);
const input = ref(null);

function onDrop(e) {
  dragging.value = false;
  if (e.dataTransfer?.files?.length) invoiceActions.addFiles(e.dataTransfer.files);
}
function onPick(e) {
  if (e.target.files?.length) invoiceActions.addFiles(e.target.files);
  e.target.value = "";
}
</script>

<template>
  <div
    class="upload border-2 border-dashed rounded-card bg-panel px-5 py-6 text-center cursor-pointer transition-colors"
    :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand'"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <div class="text-2xl">🧾</div>
    <div class="text-base font-600 mt-1.5">把发票 PDF / 图片 拖到这里，或点击选择</div>
    <div class="text-ink-soft mt-1">支持电子发票 PDF（直接抽文字）和扫描件/图片（OCR 识别）；可多选、可继续追加</div>
  </div>
</template>

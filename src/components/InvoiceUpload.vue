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
    class="upload"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <div class="icon">🧾</div>
    <div class="big">把发票 PDF / 图片 拖到这里，或点击选择</div>
    <div class="small">支持电子发票 PDF（直接抽文字）和扫描件/图片（OCR 识别）；可多选、可继续追加</div>
  </div>
</template>

<style scoped>
.upload {
  border: 2px dashed var(--line-strong);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 24px 20px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.upload:hover { border-color: var(--brand); }
.upload.dragging { border-color: var(--brand); background: var(--brand-soft); }
.icon { font-size: 26px; }
.big { font-size: 16px; font-weight: 600; margin-top: 6px; }
.small { color: var(--ink-soft); margin-top: 4px; }
</style>

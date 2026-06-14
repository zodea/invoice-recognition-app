<script setup>
import { ref } from "vue";
import { invoiceActions } from "../invoiceStore";
import { filesFromDrop, partitionFiles, dragHasSupported, SUPPORTED_HINT } from "../lib/upload";
import { toastWarn } from "../lib/toast";

const dragging = ref(false);
const rejected = ref(false);
const input = ref(null);
const folderInput = ref(null);

function intake(files) {
  const { supported, ignored } = partitionFiles(files);
  if (supported.length) {
    invoiceActions.addFiles(supported);
    if (ignored > 0) toastWarn(`已添加 ${supported.length} 个，忽略 ${ignored} 个不支持的文件。\n${SUPPORTED_HINT}`);
  } else if ((files || []).length) {
    toastWarn(`没有可识别的文件。\n${SUPPORTED_HINT}`);
  }
}

function onDragOver(e) {
  const ok = dragHasSupported(e.dataTransfer);
  if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? "copy" : "none";
  dragging.value = true;
  rejected.value = !ok;
}
function onDragLeave() {
  dragging.value = false;
  rejected.value = false;
}
async function onDrop(e) {
  dragging.value = false;
  rejected.value = false;
  intake(await filesFromDrop(e.dataTransfer));
}
function onPick(e) {
  intake(Array.from(e.target.files || []));
  e.target.value = "";
}
</script>

<template>
  <div
    class="upload border-2 border-dashed rounded-card bg-panel px-5 py-6 text-center cursor-pointer transition-colors"
    :class="rejected ? 'border-danger bg-[#fef2f2]' : dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand'"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <div class="text-2xl">{{ rejected ? "🚫" : "🧾" }}</div>
    <div class="text-base font-600 mt-1.5">
      {{ rejected ? "该类型不支持，请拖入 PDF / 图片 / 文件夹" : "把发票 PDF / 图片 / 文件夹 拖到这里，或点击选择" }}
    </div>
    <div class="text-ink-soft mt-1">支持电子发票 PDF（直接抽文字）和扫描件 / 图片（OCR）；可多选、可拖整个文件夹</div>
    <div class="mt-2">
      <button type="button" class="btn px-2.5 py-1.25 text-xs" @click.stop="folderInput.click()">📁 选择文件夹</button>
    </div>
  </div>
</template>

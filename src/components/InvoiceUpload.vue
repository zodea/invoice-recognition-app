<script setup>
import { ref } from "vue";
import { invoiceActions, invoiceStore } from "../invoiceStore";
import { filesFromDrop, partitionFiles, dragHasSupported, SUPPORTED_HINT } from "../lib/upload";
import { toastWarn } from "../lib/toast";

const dragging = ref(false);
const rejected = ref(false);
const input = ref(null);
const folderInput = ref(null);

async function intake(files) {
  if (invoiceStore.busy) { toastWarn("正在识别发票，请等待本批完成后再导入。"); return; }
  const { supported, ignored } = partitionFiles(files);
  if (supported.length) {
    await invoiceActions.addFiles(supported);
    if (ignored > 0) toastWarn(`已添加 ${supported.length} 个，忽略 ${ignored} 个不支持的文件。\n${SUPPORTED_HINT}`);
    await invoiceActions.recognizeAll();
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
  await intake(await filesFromDrop(e.dataTransfer));
}
function onPick(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  intake(files);
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
    <div class="text-ink-soft mt-1">支持 PDF 和图片，可选择或拖入文件夹；导入后自动识别并匹配台账</div>
    <div class="mt-2">
      <button type="button" class="btn px-2.5 py-1.25 text-xs" @click.stop="folderInput.click()">📁 选择文件夹</button>
    </div>
  </div>
</template>

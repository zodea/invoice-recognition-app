<script setup>
import { ref } from "vue";
import { invoiceActions } from "../invoiceStore";
import { filesFromDrop, partitionFiles, dragHasSupported, SUPPORTED_HINT } from "../lib/upload";
import { toastWarn } from "../lib/toast";

defineProps({
  variant: { type: String, default: "compact" },
});

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
    class="upload border-2 border-dashed rounded-card bg-panel text-center cursor-pointer transition-colors"
    :class="[
      variant === 'hero' ? 'w-full px-8 py-14 min-h-80 flex flex-col items-center justify-center' : 'px-5 py-6',
      rejected ? 'border-danger bg-[#fef2f2]' : dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand hover:bg-brand-soft/35',
    ]"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <div
      class="grid place-items-center rounded-full bg-brand-soft text-brand font-800"
      :class="variant === 'hero' ? 'w-20 h-20 text-4xl mb-6' : 'w-10 h-10 text-xl mx-auto mb-2'"
    >{{ rejected ? "!" : "↑" }}</div>
    <div :class="variant === 'hero' ? 'text-[28px] leading-tight font-800' : 'text-base font-600 mt-1.5'">
      {{ rejected ? "该类型不支持" : variant === "hero" ? "将发票拖放到此处" : "把发票 PDF / 图片 / 文件夹拖到这里" }}
    </div>
    <div class="text-ink-soft mt-2 max-w-120 mx-auto">
      {{ rejected ? SUPPORTED_HINT : "支持电子发票 PDF、扫描件图片和整个文件夹；可多选后批量识别。" }}
    </div>
    <div :class="variant === 'hero' ? 'mt-7 flex items-center gap-3 flex-wrap justify-center' : 'mt-2'">
      <button type="button" class="btn-primary" :class="variant === 'hero' ? 'px-8 py-3 text-base' : 'px-2.5 py-1.25 text-xs'" @click.stop="input.click()">上传文档</button>
      <button type="button" class="btn" :class="variant === 'hero' ? 'px-5 py-3' : 'px-2.5 py-1.25 text-xs'" @click.stop="folderInput.click()">选择文件夹</button>
    </div>
  </div>
</template>

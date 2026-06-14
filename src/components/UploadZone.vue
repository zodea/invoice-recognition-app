<script setup>
import { ref } from "vue";
import { actions } from "../store";
import { collectDropEntries, entriesFromFileList, entriesHaveFolders, partitionFiles, dragHasSupported, SUPPORTED_HINT } from "../lib/upload";
import { toast, toastWarn } from "../lib/toast";

const dragging = ref(false);
const rejected = ref(false);
const input = ref(null);
const folderInput = ref(null);

// 带文件夹层级 → 进整理树（导入向导，确认后才入库）；散文件 → 直接入列表。
function intakeEntries(entries) {
  const { supported, ignored } = partitionFiles((entries || []).map((e) => e.file));
  if (!supported.length) {
    if ((entries || []).length) toastWarn(`没有可识别的文件。\n${SUPPORTED_HINT}`);
    return;
  }
  if (entriesHaveFolders(entries)) {
    actions.stageEntries(entries);
    toast(`已读取文件夹结构（${supported.length} 个文件），请在整理树里确认归属后导入。`);
  } else {
    actions.addFiles(supported);
  }
  if (ignored > 0) toastWarn(`忽略 ${ignored} 个不支持的文件。\n${SUPPORTED_HINT}`);
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
  intakeEntries(await collectDropEntries(e.dataTransfer));
}
function onPick(e) {
  intakeEntries(entriesFromFileList(e.target.files));
  e.target.value = "";
}
</script>

<template>
  <div
    class="upload border-2 border-dashed rounded-card bg-panel px-3.5 py-2.5 cursor-pointer transition-colors flex items-center gap-3"
    :class="rejected ? 'border-danger bg-[#fef2f2]' : dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand'"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <div class="text-xl shrink-0" :class="rejected ? 'text-danger' : 'text-brand'">{{ rejected ? "🚫" : "⬆" }}</div>
    <div class="min-w-0 flex-1">
      <div class="text-sm font-600 truncate">{{ rejected ? "该类型不支持，请拖入 PDF / 图片 / 文件夹" : "拖入 PDF / 图片 / 文件夹，或点击选择" }}</div>
      <div class="text-ink-soft text-xs truncate">支持多选、可拖整个文件夹；上传后分配到项目分区再识别、合并、导出</div>
    </div>
    <button type="button" class="btn px-2.5 py-1.25 text-xs shrink-0" @click.stop="folderInput.click()">📁 选择文件夹</button>
  </div>
</template>

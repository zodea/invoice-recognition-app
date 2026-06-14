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
    class="upload border-2 border-dashed rounded-card bg-panel px-5 py-7 text-center cursor-pointer transition-colors"
    :class="rejected ? 'border-danger bg-[#fef2f2]' : dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand'"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <div class="text-2xl" :class="rejected ? 'text-danger' : 'text-brand'">{{ rejected ? "🚫" : "⬆" }}</div>
    <div class="text-base font-600 mt-1.5">
      {{ rejected ? "该类型不支持，请拖入 PDF / 图片 / 文件夹" : "把 PDF / 图片 / 文件夹 拖到这里，或点击选择" }}
    </div>
    <div class="text-ink-soft mt-1">支持多选、可拖整个文件夹；上传后可分配到不同项目分区，并逐份识别、合并、导出</div>
    <div class="mt-2">
      <button type="button" class="btn px-2.5 py-1.25 text-xs" @click.stop="folderInput.click()">📁 选择文件夹</button>
    </div>
  </div>
</template>

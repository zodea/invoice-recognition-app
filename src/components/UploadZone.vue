<script setup>
import { ref } from "vue";
import { actions } from "../store";
import { collectDropEntries, entriesFromFileList, entriesHaveFolders, partitionFiles, dragHasSupported, SUPPORTED_HINT } from "../lib/upload";
import { toast, toastWarn } from "../lib/toast";

const props = defineProps({ compact: Boolean });
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
    class="flex min-w-0 items-center"
    :class="[
      props.compact ? 'gap-1.5 rounded-md' : 'min-h-35 justify-center gap-3 rounded-card border-2 border-dashed bg-panel px-4',
      rejected ? 'border-danger bg-danger-soft' : dragging ? 'border-brand bg-brand-soft' : 'border-line-strong',
    ]"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <span v-if="!compact || dragging" class="text-xs text-ink-secondary" role="status">{{ rejected ? '请拖入 PDF、图片或文件夹' : dragging ? '松开以导入' : '将 PDF、图片或文件夹拖到这里' }}</span>
    <button type="button" class="ui-btn-primary" @click="input.click()">导入文件</button>
    <button type="button" class="ui-btn" @click="folderInput.click()">选择文件夹</button>
  </div>
</template>

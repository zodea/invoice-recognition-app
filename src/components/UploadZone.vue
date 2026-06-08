<script setup>
import { ref } from "vue";
import { actions } from "../store";

const dragging = ref(false);
const input = ref(null);

function onDrop(e) {
  dragging.value = false;
  const files = e.dataTransfer?.files;
  if (files && files.length) actions.addFiles(files);
}
function onPick(e) {
  if (e.target.files?.length) actions.addFiles(e.target.files);
  e.target.value = "";
}
</script>

<template>
  <div
    class="upload border-2 border-dashed rounded-card bg-panel px-5 py-7 text-center cursor-pointer transition-colors"
    :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:border-brand'"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
    @click="input.click()"
  >
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <div class="text-2xl text-brand">⬆</div>
    <div class="text-base font-600 mt-1.5">把 PDF / 图片 拖到这里，或点击选择</div>
    <div class="text-ink-soft mt-1">支持多选；上传后可分配到不同项目分区，并逐份识别、合并、导出</div>
  </div>
</template>

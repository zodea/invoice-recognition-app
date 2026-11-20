<script setup>
import { ref } from 'vue';
import { filesFromDrop } from '../lib/upload.js';
import { toastWarn } from '../lib/toast.js';

const props = defineProps({
  accept: { type: String, default: '.xlsx,.xls' }, label: { type: String, default: '选择 Excel' },
  multiple: Boolean, folders: Boolean, disabled: Boolean,
});
const emit = defineEmits(['files']);
const picker = ref(null), folder = ref(null), over = ref(false), reading = ref(false);
function submit(files) {
  if (props.disabled) return;
  const types = props.accept.split(',').map(s => s.trim().toLowerCase());
  const accepted = files.filter(file => !file.name.startsWith('~$') && types.some(t =>
    t.startsWith('.') ? file.name.toLowerCase().endsWith(t) :
    t.endsWith('/*') ? file.type.startsWith(t.slice(0, -1)) : file.type === t));
  if (!accepted.length) { toastWarn('请选择支持的文件：' + props.accept); return; }
  if (!props.multiple && accepted.length !== 1) { toastWarn('此处请一次导入一个文件。'); return; }
  emit('files', accepted);
}
function picked(event) {
  const files = Array.from(event.target.files);
  event.target.value = '';
  if (files.length) submit(files);
}
function drag(event) {
  if (!Array.from(event.dataTransfer.types).includes('Files')) return;
  event.preventDefault();
  event.stopPropagation();
  over.value = !props.disabled && !reading.value;
  event.dataTransfer.dropEffect = over.value ? 'copy' : 'none';
}
async function drop(event) {
  over.value = false;
  if (props.disabled || reading.value) return;
  reading.value = true;
  try {
    submit(await filesFromDrop(event.dataTransfer));
  } catch (error) { toastWarn('读取拖入的文件失败：' + error.message); }
  finally { reading.value = false; }
}
</script>

<template>
  <div class="import-drop" :class="{ over }" @dragenter="drag" @dragover="drag"
    @dragleave="!$event.currentTarget.contains($event.relatedTarget) && (over = false)" @drop.prevent.stop="drop">
    <span>{{ over ? '松开以读取文件' : (multiple || folders ? '拖入文件或文件夹' : '拖入一个文件') }}</span>
    <input ref="picker" type="file" hidden :accept="accept" :multiple="multiple" @change="picked" />
    <button type="button" class="btn" :disabled="disabled || reading" @click="picker.click()">{{ label }}</button>
    <template v-if="folders">
      <input ref="folder" type="file" hidden webkitdirectory multiple @change="picked" />
      <button type="button" class="btn" :disabled="disabled || reading" @click="folder.click()">选择文件夹</button>
    </template>
  </div>
</template>

<style scoped>
.import-drop { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px; min-width:0; padding:9px 12px; border:1px dashed #93adc9; border-radius:7px; background:#f7faff; }
.import-drop span { color:#4d6580; font-size:12px; overflow-wrap:anywhere; }
.import-drop.over { background:#e5f1ff; border-color:#1867c0; outline:2px solid #9ac5ef; }
</style>

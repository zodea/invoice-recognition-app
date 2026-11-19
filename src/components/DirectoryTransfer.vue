<script setup>
import { computed, ref, shallowRef } from 'vue';
import { DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import FileDropInput from './FileDropInput.vue';
import { directory, saveDirectory } from '../lib/expense-directory.js';
import { readDirectoryWorkbook, exportDirectoryWorkbook, mergeDirectoryWorkbook } from '../lib/directory-workbook.js';
import { saveBytesToChosenDir } from '../lib/invoice-export-package.js';
import { downloadBytes } from '../lib/file-utils.js';
import { toast, toastError } from '../lib/toast.js';

const open = ref(false), busy = ref(false), source = shallowRef(null), filename = ref(''), message = ref('');
const plan = computed(() => source.value && mergeDirectoryWorkbook(directory, source.value));
const labels = { added: '新增档案', restored: '恢复档案', rules: '新增厂家归属', trash: '新增回收站条目', skipped: '已有或重复' };
let generation = 0;
function toggle(value) {
  generation++;
  open.value = value; source.value = null; message.value = ''; filename.value = ''; busy.value = false;
}
async function read([file]) {
  const version = ++generation;
  busy.value = true; source.value = null; message.value = ''; filename.value = file.name;
  try { const data = readDirectoryWorkbook(await file.arrayBuffer()); if (generation === version) source.value = data; }
  catch (error) { if (generation === version) message.value = error.message; }
  finally { if (generation === version) busy.value = false; }
}
function confirm() {
  if (!plan.value?.changed) return;
  try { const { next, changed } = plan.value; saveDirectory(next); toggle(false); toast('已合并基础档案，共 ' + changed + ' 项变更。'); }
  catch (error) { message.value = error.message; }
}
async function download() {
  try {
    const bytes = exportDirectoryWorkbook(directory);
    const name = '基础档案.xlsx';
    const result = await saveBytesToChosenDir(bytes, name);
    if (result.canceled) return;
    if (result.fallbackDownload) downloadBytes(bytes, name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(result.saved ? '基础档案已保存：' + result.saved : '已导出基础档案');
  } catch (error) { toastError('导出失败：' + error.message); }
}
</script>

<template>
  <DialogRoot :open="open" @update:open="toggle">
    <DialogTrigger class="btn">导入基础档案</DialogTrigger>
    <DialogPortal><DialogOverlay class="file-import-overlay" /><DialogContent class="file-import-dialog">
      <header><DialogTitle>导入基础档案</DialogTitle><DialogClose class="btn">关闭</DialogClose></header>
      <DialogDescription>使用本页导出的 Excel，可填写基础档案、厂家归属及档案回收站三个工作表，也可只保留需要导入的工作表。</DialogDescription>
      <FileDropInput :disabled="busy" @files="read" />
      <p v-if="filename">{{ filename }}</p>
      <p v-if="message" role="alert">{{ message }}</p>
      <template v-if="plan">
        <dl class="directory-counts"><template v-for="(label, key) in labels" :key="key"><dt>{{ label }}</dt><dd>{{ plan.counts[key] }}</dd></template></dl>
        <p>同名有效档案优先保留。导入的有效档案如在本机回收站，将恢复使用。</p>
        <button type="button" class="btn-primary" :disabled="busy || !plan.changed" @click="confirm">确认合并 {{ plan.changed }} 项</button>
      </template>
    </DialogContent></DialogPortal>
  </DialogRoot>
  <button type="button" class="btn" @click="download">导出基础档案</button>
</template>
<style scoped>
.directory-counts { display:grid; grid-template-columns:1fr auto; gap:6px; margin:0; font-size:13px; }
.directory-counts dd { margin:0; font-weight:600; font-variant-numeric:tabular-nums; }
</style>

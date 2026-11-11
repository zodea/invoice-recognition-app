<script setup>
import { ref } from "vue";
import { invoiceActions, invoiceStore } from "../invoiceStore";
import { partitionFiles, SUPPORTED_HINT } from "../lib/upload";
import { toastWarn } from "../lib/toast";

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

defineExpose({ intake });
function onPick(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  intake(files);
}
</script>

<template>
  <div class="invoice-upload-actions">
    <input ref="input" type="file" multiple accept=".pdf,image/*" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <button type="button" class="btn-primary" :disabled="invoiceStore.busy" @click="input.click()">＋ 导入发票</button>
    <button type="button" class="btn" :disabled="invoiceStore.busy" @click="folderInput.click()">选择文件夹</button>
  </div>
</template>

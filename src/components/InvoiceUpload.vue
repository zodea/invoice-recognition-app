<script setup>
import { ref } from "vue";
import { invoiceActions, invoiceStore } from "../invoiceStore.js";
import { partitionFiles, SUPPORTED_HINT } from "../lib/upload";
import { toastWarn } from "../lib/toast";
import { intakeFile, isSystemFile } from '../lib/fileIntake.js';
import { readInvoiceSourceWorkbook } from '../lib/invoiceExcelImport.js';
import { readPaymentBatch } from '../lib/payment-records.js';

const emit = defineEmits(['payment-batch', 'invoice-workbooks']);
const input = ref(null);
const folderInput = ref(null);

async function intake(files) {
  if (invoiceStore.busy) { toastWarn("正在识别发票，请等待本批完成后再导入。"); return; }
  files = Array.from(files).filter(file => !isSystemFile(file.name));
  const spreadsheets = files.filter(file => /\.xlsx?$/i.test(file.name));
  if (spreadsheets.length) {
    const invoiceBooks = [], otherBooks = [];
    for (const file of spreadsheets) {
      try {
        const bytes = await file.arrayBuffer();
        const source = intakeFile(file).relativePath;
        const invoiceBook = readInvoiceSourceWorkbook(bytes, source);
        if (invoiceBook.records.length) invoiceBooks.push(invoiceBook);
        if (!invoiceBook.records.length || readPaymentBatch(bytes, source).records.length) otherBooks.push(file);
      } catch { otherBooks.push(file); }
    }
    if (invoiceBooks.length) emit('invoice-workbooks', invoiceBooks);
    if (otherBooks.length) emit('payment-batch', [...otherBooks, ...files.filter(file => !spreadsheets.includes(file))]);
    if (!invoiceBooks.length) return;
    files = files.filter(file => !spreadsheets.includes(file));
  }
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
    <input ref="input" type="file" multiple accept=".pdf,image/*,.xlsx,.xls" hidden @change="onPick" />
    <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onPick" />
    <button type="button" class="ui-btn-primary" :disabled="invoiceStore.busy" @click="input.click()">＋ 导入文件</button>
    <button type="button" class="ui-btn" :disabled="invoiceStore.busy" @click="folderInput.click()">导入文件夹</button>
  </div>
</template>
<style scoped>
.invoice-upload-actions { flex: none; flex-wrap: nowrap; }
</style>

<script setup>
import { ref } from "vue";
import { invoiceActions, invoiceStore } from "../invoiceStore.js";
import { partitionFiles, SUPPORTED_HINT } from "../lib/upload";
import { toastWarn } from "../lib/toast";
import { intakeFile, isSystemFile, paymentEvidenceFolder, pickDesktopIntakeFolder } from '../lib/fileIntake.js';
import { isTauri } from '../lib/platform.js';

const emit = defineEmits(['payment-batch', 'invoice-workbooks']);
const input = ref(null);
const folderInput = ref(null);
const progress = ref(null);
function report(label, done, total) { progress.value = { label, done, total }; }

async function chooseFolder() {
  if (!isTauri()) return folderInput.value.click();
  await intake(async () => {
    const selection = await pickDesktopIntakeFolder((done, total) => report('读取文件夹', done, total));
    if (!selection) return [];
    if (selection.skipped) toastWarn(`已跳过 ${selection.skipped} 个无法读取、超出大小限制或指向其他目录的项目。`);
    if (!selection.files.length) toastWarn('所选目录没有可导入的文件。');
    return selection.files;
  });
}

async function intake(source) {
  if (invoiceStore.busy || progress.value) { toastWarn('请等待当前导入或识别完成。'); return; }
  report('读取导入文件');
  try {
    const files = typeof source === 'function' ? await source() : source;
    await importFiles(files);
  } catch (error) {
    toastWarn('导入失败：' + (error.message || error));
  } finally {
    progress.value = null;
  }
}

async function importFiles(files) {
  files = Array.from(files).filter(file => !isSystemFile(file.name));
  const spreadsheets = files.filter(file => /\.xlsx?$/i.test(file.name));
  const documents = files.filter(file => !spreadsheets.includes(file));
  const paymentDocuments = documents.filter(paymentEvidenceFolder);
  const looseDocuments = documents.filter(file => !intakeFile(file).parentFolder);
  if (spreadsheets.length) {
    const invoiceBooks = [], otherBooks = [];
    report('读取 Excel 清单', 0, spreadsheets.length);
    for (const [index, file] of spreadsheets.entries()) {
      try {
        const [{ readInvoiceSourceWorkbook }, { readPaymentBatch }] = await Promise.all([
          import('../lib/invoiceExcelImport.js'), import('../lib/payment-records.js'),
        ]);
        const bytes = await file.arrayBuffer();
        const source = intakeFile(file).relativePath;
        const invoiceBook = readInvoiceSourceWorkbook(bytes, source);
        if (invoiceBook.records.length) invoiceBooks.push(invoiceBook);
        if (!invoiceBook.records.length || readPaymentBatch(bytes, source).records.length) otherBooks.push(file);
      } catch { otherBooks.push(file); }
      report('读取 Excel 清单', index + 1, spreadsheets.length);
    }
    if (invoiceBooks.length) emit('invoice-workbooks', invoiceBooks);
    if (otherBooks.length) emit('payment-batch', [...otherBooks, ...(invoiceBooks.length ? [...paymentDocuments, ...looseDocuments] : documents)]);
    if (!invoiceBooks.length) return;
  }
  if (!spreadsheets.length && paymentDocuments.length) emit('payment-batch', paymentDocuments);
  files = documents.filter(file => !paymentDocuments.includes(file));
  const { supported, ignored } = partitionFiles(files);
  if (supported.length) {
    report('导入票据', 0, supported.length);
    await invoiceActions.addFiles(supported, (done, total) => report('导入票据', done, total));
    if (ignored > 0) toastWarn(`已添加 ${supported.length} 个，忽略 ${ignored} 个不支持的文件。\n${SUPPORTED_HINT}`);
    await invoiceActions.recognizeAll();
  } else if ((files || []).length) {
    toastWarn(`没有可识别的文件。\n${SUPPORTED_HINT}`);
  }
}

defineExpose({ intake, progress });
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
    <button type="button" class="ui-btn-primary" :disabled="invoiceStore.busy || !!progress" @click="input.click()">＋ 导入文件</button>
    <button type="button" class="ui-btn" :disabled="invoiceStore.busy || !!progress" @click="chooseFolder">导入文件夹</button>
  </div>
</template>
<style scoped>
.invoice-upload-actions { flex: none; flex-wrap: nowrap; }
</style>

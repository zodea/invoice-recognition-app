<script setup>
import { computed, ref } from "vue";
import { invoiceStore, invoiceActions } from "../invoiceStore";
import { buildCurrentInputInvoiceReportBytes, buildHistoryReportBytes, currentInputReportName, historyReportName, ledgerStats } from "../lib/invoice-ledger";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { downloadBytes } from "../lib/invoice-layout";
import InvoiceLedgerViewer from "./InvoiceLedgerViewer.vue";

const viewerOpen = ref(false);

const fileRef = ref(null);
const busy = ref(false);
const dragging = ref(false);
const msg = ref("");
const stats = computed(() => ledgerStats(invoiceStore.ledger));

function chooseFile() {
  fileRef.value?.click();
}

function pickExcelFile(files) {
  return Array.from(files || []).find((f) => /\.(xlsx|xls)$/i.test(f.name));
}

async function importLedgerFile(file) {
  if (!file) return;
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    msg.value = "请导入税务局导出的 Excel 文件（.xlsx / .xls）。";
    return;
  }
  busy.value = true;
  msg.value = "正在导入进项发票历史…";
  try {
    const r = await invoiceActions.importInputInvoiceReport(file);
    msg.value = `已导入 ${r.imported} 张，新增 ${r.added} 张，更新 ${r.updated} 张。`;
  } catch (err) {
    msg.value = "导入失败：" + ((err && err.message) || err);
  } finally {
    busy.value = false;
  }
}

async function saveLedgerBytes(bytes, name, okMsg, dlMsg) {
  busy.value = true;
  msg.value = "请选择保存目录…";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) msg.value = "已取消导出。";
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); msg.value = dlMsg; }
    else msg.value = `${okMsg}：${r.saved}`;
  } catch (err) {
    if (err && err.name === "AbortError") msg.value = "已取消导出。";
    else { downloadBytes(bytes, name, mime); msg.value = "保存目录失败，已改为下载。"; }
  } finally {
    busy.value = false;
  }
}

async function exportHistory() {
  if (!stats.value.total) { window.alert("当前还没有历史进项发票台账。"); return; }
  await saveLedgerBytes(buildHistoryReportBytes(invoiceStore.ledger), historyReportName(), "已保存历史台账", "已导出历史台账。");
}

async function exportCurrentInputStatus() {
  if (!invoiceStore.invoices.length) { window.alert("当前还没有导入发票。"); return; }
  await saveLedgerBytes(buildCurrentInputInvoiceReportBytes(invoiceStore.invoices, invoiceStore.ledger), currentInputReportName(), "已保存当前进项发票状态", "已导出当前进项发票状态。");
}

async function importReport(e) {
  const file = pickExcelFile(e.target.files);
  e.target.value = "";
  await importLedgerFile(file);
}

async function onDrop(e) {
  dragging.value = false;
  if (busy.value) return;
  const file = pickExcelFile(e.dataTransfer?.files);
  if (!file) {
    msg.value = "没有找到可导入的 Excel 文件，请拖入 .xlsx 或 .xls。";
    return;
  }
  await importLedgerFile(file);
}

function clearLedger() {
  if (!stats.value.total) return;
  const ok = window.confirm(
    `确认清空历史进项台账吗？\n\n当前共有 ${stats.value.total} 张历史记录。清空后，已认证/已打印状态会被删除；如果是误上传了错误 Excel，可以清空后重新导入正确文件。`
  );
  if (!ok) { msg.value = "已取消清空。"; return; }
  invoiceActions.clearLedger();
  msg.value = "已清空历史进项台账，可以重新导入正确的进项 Excel。";
}
</script>

<template>
  <section
    class="panel p-2.5 transition-colors"
    :class="dragging ? '!border-brand bg-brand-soft shadow-[0_0_0_2px_rgba(37,99,235,0.16)]' : ''"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileRef" class="hidden" type="file" accept=".xlsx,.xls" @change="importReport" />
    <div class="flex items-start justify-between gap-2.5">
      <div>
        <h2 class="m-0 text-[15px] font-700">历史进项台账</h2>
        <p class="mt-0.5 text-ink-soft text-xs leading-relaxed">拖入或选择税务局进项发票清单，本地记录认证/使用状态。</p>
      </div>
    </div>
    <div
      class="mt-2 p-2 border border-dashed rounded-md text-xs font-700 transition-colors"
      :class="dragging ? 'border-brand bg-white text-brand' : 'border-line-strong bg-[#f8fafc] text-ink-soft'"
    >
      {{ dragging ? "松开即可导入进项 Excel" : "可拖拽 .xlsx / .xls 到这里导入" }}
    </div>
    <div class="flex gap-2.5 flex-wrap my-2.25 text-ink-soft text-xs">
      <span><b class="text-ink text-[15px]">{{ stats.total }}</b> 张</span>
      <span><b class="text-ink text-[15px]">{{ stats.verified }}</b> 已认证</span>
      <span><b class="text-ink text-[15px]">{{ stats.printed }}</b> 已打印</span>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button class="btn-primary px-2.5 py-1.75" :disabled="busy" @click="chooseFile">导入进项 Excel</button>
      <button class="btn px-2.5 py-1.75" :disabled="!stats.total" @click="viewerOpen = true">查看台账</button>
      <button class="btn px-2.5 py-1.75" :disabled="busy || !stats.total" @click="exportHistory">导出历史台账</button>
      <button class="btn px-2.5 py-1.75" :disabled="busy || !invoiceStore.invoices.length" @click="exportCurrentInputStatus">导出当前进项状态</button>
      <button class="btn px-2.5 py-1.75 border-[#fecaca] text-[#991b1b] bg-[#fef2f2]" :disabled="busy || !stats.total" @click="clearLedger">清空历史台账</button>
    </div>
    <div class="mt-2 text-ink-soft text-xs" v-if="msg">{{ msg }}</div>
    <InvoiceLedgerViewer v-model:open="viewerOpen" />
  </section>
</template>

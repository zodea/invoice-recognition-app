<script setup>
import { computed, ref } from "vue";
import { invoiceStore, invoiceActions } from "../invoiceStore";
import { buildCurrentInputInvoiceReportBytes, buildHistoryReportBytes, currentInputReportName, historyReportName, ledgerStats } from "../lib/invoice-ledger";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { downloadBytes } from "../lib/invoice-layout";

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

async function exportHistory() {
  if (!stats.value.total) {
    window.alert("当前还没有历史进项发票台账。");
    return;
  }
  busy.value = true;
  msg.value = "请选择保存目录…";
  const bytes = buildHistoryReportBytes(invoiceStore.ledger);
  const name = historyReportName();
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) {
      msg.value = "已取消导出。";
    } else if (r.fallbackDownload) {
      downloadBytes(bytes, name, mime);
      msg.value = "已导出历史台账。";
    } else {
      msg.value = `已保存历史台账：${r.saved}`;
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      msg.value = "已取消导出。";
    } else {
      downloadBytes(bytes, name, mime);
      msg.value = "保存目录失败，已改为下载。";
    }
  } finally {
    busy.value = false;
  }
}

async function exportCurrentInputStatus() {
  if (!invoiceStore.invoices.length) {
    window.alert("当前还没有导入发票。");
    return;
  }
  busy.value = true;
  msg.value = "请选择保存目录…";
  const bytes = buildCurrentInputInvoiceReportBytes(invoiceStore.invoices, invoiceStore.ledger);
  const name = currentInputReportName();
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) {
      msg.value = "已取消导出。";
    } else if (r.fallbackDownload) {
      downloadBytes(bytes, name, mime);
      msg.value = "已导出当前进项发票状态。";
    } else {
      msg.value = `已保存当前进项发票状态：${r.saved}`;
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      msg.value = "已取消导出。";
    } else {
      downloadBytes(bytes, name, mime);
      msg.value = "保存目录失败，已改为下载。";
    }
  } finally {
    busy.value = false;
  }
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
</script>

<template>
  <section
    class="panel"
    :class="{ dragging }"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileRef" class="hidden" type="file" accept=".xlsx,.xls" @change="importReport" />
    <div class="head">
      <div>
        <h2>历史进项台账</h2>
        <p>拖入或选择税务局进项发票清单，本地记录认证/使用状态。</p>
      </div>
    </div>
    <div class="drop-hint">
      <span>{{ dragging ? "松开即可导入进项 Excel" : "可拖拽 .xlsx / .xls 到这里导入" }}</span>
    </div>
    <div class="stats">
      <span><b>{{ stats.total }}</b> 张</span>
      <span><b>{{ stats.verified }}</b> 已认证</span>
      <span><b>{{ stats.printed }}</b> 已打印</span>
    </div>
    <div class="actions">
      <button class="primary" :disabled="busy" @click="chooseFile">导入进项 Excel</button>
      <button :disabled="busy || !stats.total" @click="exportHistory">导出历史台账</button>
      <button :disabled="busy || !invoiceStore.invoices.length" @click="exportCurrentInputStatus">导出当前进项状态</button>
    </div>
    <div class="msg" v-if="msg">{{ msg }}</div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  box-shadow: var(--shadow);
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.panel.dragging {
  border-color: var(--brand);
  background: var(--brand-soft);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.16), var(--shadow);
}
.hidden {
  display: none;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
h2 {
  margin: 0;
  font-size: 15px;
}
p {
  margin: 2px 0 0;
  color: var(--ink-soft);
  font-size: 12px;
  line-height: 1.4;
}
.stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 9px 0;
  color: var(--ink-soft);
  font-size: 12px;
}
.drop-hint {
  margin-top: 8px;
  padding: 8px;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  background: #f8fafc;
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 700;
}
.panel.dragging .drop-hint {
  border-color: var(--brand);
  background: #fff;
  color: var(--brand);
}
.stats b {
  color: var(--ink);
  font-size: 15px;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
button {
  border: 1px solid var(--line-strong);
  background: #fff;
  border-radius: 6px;
  padding: 7px 10px;
  font-weight: 700;
}
button.primary {
  border: none;
  background: var(--brand);
  color: #fff;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.msg {
  margin-top: 8px;
  color: var(--ink-soft);
  font-size: 12px;
}
</style>

<script setup>
import { ref, computed } from "vue";
import { invoiceStore, invoiceSummary, orderedForPrint } from "../invoiceStore";
import { buildPrintLayout, openForPrint, downloadBytes } from "../lib/invoice-layout";
import { buildInvoiceWorkbookBytes } from "../lib/invoice-excel";
import {
  canUseTauriExport,
  pickTauriExportDir,
  writeInvoiceExportPackage,
  writeInvoiceExportPackageTauri,
} from "../lib/invoice-export-package";

const busy = ref(false);
const msg = ref("");
const groupByBuyer = ref(true);

const included = computed(() => orderedForPrint().map((x) => x.inv));
const summary = computed(() => invoiceSummary());

async function makeLayout() {
  if (!included.value.length) {
    window.alert("没有勾选要打印的发票。");
    return null;
  }
  busy.value = true;
  msg.value = "正在排版…";
  try {
    return await buildPrintLayout(included.value, { perPage: invoiceStore.perPage });
  } catch (e) {
    msg.value = "排版失败：" + ((e && e.message) || e);
    return null;
  } finally {
    busy.value = false;
  }
}

async function printNow() {
  const bytes = await makeLayout();
  if (bytes) {
    openForPrint(bytes);
    msg.value = "已在新标签打开打印版，按 Ctrl+P 打印。";
  }
}
async function downloadPdf() {
  const bytes = await makeLayout();
  if (bytes) {
    downloadBytes(bytes, `发票打印版_每页${invoiceStore.perPage}张.pdf`);
    msg.value = "已下载打印版 PDF。";
  }
}
function exportExcel() {
  if (!included.value.length) {
    window.alert("没有勾选发票。");
    return;
  }
  const bytes = buildInvoiceWorkbookBytes(included.value);
  downloadBytes(bytes, "发票开票明细与汇总账单.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  msg.value = "已导出明细 + 汇总账单 Excel。";
}

async function exportPackage() {
  if (!included.value.length) {
    window.alert("没有勾选发票。");
    return;
  }
  if (!canUseTauriExport() && typeof window.showDirectoryPicker !== "function") {
    window.alert("当前运行环境不支持直接选择保存目录，请先使用 Excel / PDF 下载。");
    return;
  }

  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    const excelBytes = buildInvoiceWorkbookBytes(included.value);
    let result;
    if (canUseTauriExport()) {
      const dir = await pickTauriExportDir();
      if (!dir) {
        msg.value = "已取消导出。";
        return;
      }
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackageTauri(included.value, dir, {
        excelBytes,
        groupByBuyer: groupByBuyer.value,
      });
    } else {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackage(included.value, dir, {
        excelBytes,
        groupByBuyer: groupByBuyer.value,
      });
    }
    msg.value = `已导出 ${result.fileCount} 个原文件，统计表：${result.excelName || "未生成"}。`;
  } catch (e) {
    if (e && e.name === "AbortError") {
      msg.value = "已取消导出。";
    } else {
      msg.value = "整理导出失败：" + ((e && e.message) || e);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="panel">
    <div class="summary">
      <span>勾选 <b>{{ summary.count }}</b> 张</span>
      <span>价税合计 <b class="hl">{{ summary.total.toFixed(2) }}</b></span>
      <span>税额 <b>{{ summary.tax.toFixed(2) }}</b></span>
    </div>

    <div class="actions-row">
      <div class="opts">
      <span>每页</span>
      <label v-for="n in [1, 2, 4]" :key="n" class="radio">
        <input type="radio" :value="n" v-model="invoiceStore.perPage" /> {{ n }}张
      </label>
      <label class="radio">
        <input type="checkbox" v-model="groupByBuyer" /> 按购买方分目录
      </label>
      </div>
      <div class="btns">
        <button class="primary" :disabled="busy || !included.length" @click="printNow">打印</button>
        <button :disabled="busy || !included.length" @click="downloadPdf">PDF</button>
        <button :disabled="!included.length" @click="exportExcel">Excel</button>
        <button :disabled="busy || !included.length" @click="exportPackage">整理导出</button>
      </div>
    </div>
    <div class="msg" v-if="msg">{{ msg }}</div>
  </div>
</template>

<style scoped>
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  box-shadow: var(--shadow);
}
.summary { display: flex; gap: 12px; flex-wrap: wrap; color: var(--ink-soft); margin-bottom: 8px; }
.summary b { color: var(--ink); font-size: 15px; }
.summary b.hl { color: var(--brand); }
.actions-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.opts { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; color: var(--ink-soft); }
.radio { display: inline-flex; align-items: center; gap: 4px; color: var(--ink); }
.btns { display: flex; gap: 8px; flex-wrap: wrap; }
.btns button { border: 1px solid var(--line-strong); background: #fff; border-radius: 6px; padding: 7px 11px; font-weight: 700; }
.btns button.primary { border: none; background: var(--brand); color: #fff; }
.btns button:disabled { opacity: 0.5; cursor: default; }
.msg { margin-top: 8px; color: var(--ink-soft); font-size: 13px; }
</style>

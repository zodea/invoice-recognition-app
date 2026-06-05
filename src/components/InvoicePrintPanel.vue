<script setup>
import { ref, computed } from "vue";
import { invoiceStore, invoiceSummary, orderedForPrint } from "../invoiceStore";
import { buildPrintLayout, openForPrint, downloadBytes } from "../lib/invoice-layout";
import { buildInvoiceWorkbookBytes } from "../lib/invoice-excel";
import { buildReimburseWorkbookBytes, reimburseWorkbookName } from "../lib/invoice-reimburse";
import {
  canUseTauriExport,
  pickTauriExportDir,
  writeInvoiceExportPackage,
  writeInvoiceExportPackageTauri,
  saveBytesToChosenDir,
  GROUP_DIMENSIONS,
} from "../lib/invoice-export-package";

const busy = ref(false);
const msg = ref("");

// 待优化#3：分目录维度多选下拉。点选先后即文件夹嵌套顺序，序号在标签上体现。
const dimsOpen = ref(false);
function dimOrder(key) {
  return invoiceStore.groupDims.indexOf(key);
}
function toggleDim(key) {
  const i = invoiceStore.groupDims.indexOf(key);
  if (i >= 0) invoiceStore.groupDims.splice(i, 1);
  else invoiceStore.groupDims.push(key);
}
const dimsLabel = computed(() => {
  if (!invoiceStore.groupDims.length) return "不分目录";
  return invoiceStore.groupDims
    .map((k) => GROUP_DIMENSIONS.find((d) => d.key === k)?.label || k)
    .join(" / ");
});

const included = computed(() => orderedForPrint().map((x) => x.inv));
const summary = computed(() => invoiceSummary());
// 至少有一张已识别才允许导出 PDF / Excel（未识别导出没有意义）
const hasRecognized = computed(() => included.value.some((inv) => inv.status === "done"));

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
    msg.value = "已调起打印（打印内容为左侧排版）。若未弹出，请检查弹窗拦截。";
  }
}
async function downloadPdf() {
  const bytes = await makeLayout();
  if (!bytes) return;
  const name = `发票打印版_每页${invoiceStore.perPage}张.pdf`;
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) { msg.value = "已取消保存。"; return; }
    if (r.fallbackDownload) { downloadBytes(bytes, name); msg.value = "已下载打印版 PDF。"; return; }
    msg.value = `已保存打印版 PDF：${r.saved}`;
  } catch (e) {
    if (e && e.name === "AbortError") msg.value = "已取消保存。";
    else { downloadBytes(bytes, name); msg.value = "保存目录失败，已改为下载。"; }
  } finally {
    busy.value = false;
  }
}
async function exportExcel() {
  if (!included.value.length) {
    window.alert("没有勾选发票。");
    return;
  }
  const bytes = buildInvoiceWorkbookBytes(included.value);
  const name = "发票开票明细与汇总账单.xlsx";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) { msg.value = "已取消保存。"; return; }
    if (r.fallbackDownload) { downloadBytes(bytes, name, mime); msg.value = "已导出明细 + 汇总账单 Excel。"; return; }
    msg.value = `已保存 Excel：${r.saved}`;
  } catch (e) {
    if (e && e.name === "AbortError") msg.value = "已取消保存。";
    else { downloadBytes(bytes, name, mime); msg.value = "保存目录失败，已改为下载。"; }
  } finally {
    busy.value = false;
  }
}

async function exportReimburse() {
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
  const bytes = buildReimburseWorkbookBytes(included.value);
  const name = reimburseWorkbookName(included.value);
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) { msg.value = "已取消保存。"; return; }
    if (r.fallbackDownload) { downloadBytes(bytes, name, mime); msg.value = "已导出财务费用报销表。"; return; }
    msg.value = `已保存财务费用报销表：${r.saved}`;
  } catch (e) {
    if (e && e.name === "AbortError") msg.value = "已取消保存。";
    else { downloadBytes(bytes, name, mime); msg.value = "保存目录失败，已改为下载。"; }
  } finally {
    busy.value = false;
  }
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
        dims: invoiceStore.groupDims,
      });
    } else {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackage(included.value, dir, {
        excelBytes,
        dims: invoiceStore.groupDims,
      });
    }
    msg.value = `已导出到「${result.parent}」：${result.fileCount} 个文件，统计表：${result.excelName || "未生成"}。`;
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
      <div class="dims" @keydown.esc="dimsOpen = false" @mouseleave="dimsOpen = false">
        <button type="button" class="dims-trigger" @click="dimsOpen = !dimsOpen">
          分目录：<b>{{ dimsLabel }}</b> <span class="caret">▾</span>
        </button>
        <div v-if="dimsOpen" class="dims-menu">
          <p class="dims-tip">勾选顺序即文件夹层级；左右两栏同步分组</p>
          <label v-for="d in GROUP_DIMENSIONS" :key="d.key" class="dims-item">
            <input type="checkbox" :checked="dimOrder(d.key) >= 0" @change="toggleDim(d.key)" />
            <span class="badge" v-if="dimOrder(d.key) >= 0">{{ dimOrder(d.key) + 1 }}</span>
            {{ d.label }}
          </label>
          <button type="button" class="dims-clear" @click="invoiceStore.groupDims.splice(0)">清除分目录</button>
        </div>
      </div>
      </div>
      <div class="btns">
        <button class="primary" :disabled="busy || !included.length" @click="printNow">打印</button>
        <button :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="downloadPdf">PDF</button>
        <button :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="exportExcel">Excel</button>
        <button :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="exportPackage">整理导出</button>
        <button :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="exportReimburse">财务费用报销导出</button>
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
.dims { position: relative; }
.dims-trigger { border: 1px solid var(--line-strong); background: #fff; border-radius: 6px; padding: 6px 10px; font-weight: 700; color: var(--ink); }
.dims-trigger b { color: var(--brand); font-weight: 800; }
.dims-trigger .caret { color: var(--ink-soft); }
.dims-menu { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 220px; background: #fff; border: 1px solid var(--line-strong); border-radius: 8px; box-shadow: var(--shadow); padding: 8px; display: flex; flex-direction: column; gap: 4px; }
.dims-tip { margin: 0 0 4px; font-size: 11px; color: var(--ink-soft); }
.dims-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 6px; cursor: pointer; color: var(--ink); }
.dims-item:hover { background: var(--brand-soft); }
.dims-item .badge { min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--brand); color: #fff; font-size: 11px; font-weight: 800; }
.dims-clear { margin-top: 4px; border: none; background: none; color: var(--ink-soft); text-align: left; padding: 4px 6px; font-size: 12px; }
.dims-clear:hover { color: var(--danger); }
.btns { display: flex; gap: 8px; flex-wrap: wrap; }
.btns button { border: 1px solid var(--line-strong); background: #fff; border-radius: 6px; padding: 7px 11px; font-weight: 700; }
.btns button.primary { border: none; background: var(--brand); color: #fff; }
.btns button:disabled { opacity: 0.5; cursor: default; }
.msg { margin-top: 8px; color: var(--ink-soft); font-size: 13px; }
</style>

<script setup>
import { appStorage } from '../lib/app-storage.js';

import { invoiceProblems } from "../lib/invoice-review";
import { ref, computed } from "vue";
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { invoiceStore, invoiceActions, invoiceSummary, orderedForPrint, groupPath } from "../invoiceStore.js";
import { buildPrintLayout, openForPrint } from "../lib/invoice-layout";
import { downloadBytes } from "../lib/file-utils.js";
import { buildInvoiceWorkbookBytes } from "../lib/invoice-excel";
import { buildCheckedInvoiceWorkbook } from '../lib/invoiceExcelImport.js';
import { buildReimburseWorkbookBytes, reimburseWorkbookName } from "../lib/invoice-reimburse";
import {
  canUseTauriExport,
  pickTauriExportDir,
  writeInvoiceExportPackage,
  writeInvoiceExportPackageTauri,
  saveBytesToChosenDir,
  GROUP_DIMENSIONS,
  invoiceExportFileName,
} from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

import InvoicePreview from './InvoicePreview.vue';
import ConfirmAction from './ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';

const open = defineModel('open', { type: Boolean, default: false });
const props = defineProps({ sourceWorkbooks: { type: Array, default: () => [] }, fileMatches: Object });
const emit = defineEmits(['edit-invoice']);
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const filenameTemplate = ref(appStorage.getItem("invoiceFilenameTemplate") || "{销售方}：{日期}={金额}元");
const exportSort = ref(appStorage.getItem("invoiceExportSort") || "original");
const exportDirection = ref(appStorage.getItem("invoiceExportDirection") || "asc");
const busy = ref(false);
const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const runningAction = ref(false);
async function runAction(action) {
  if (runningAction.value || busy.value) return;
  runningAction.value = true;
  try { await action(); }
  catch (error) { toastError('操作失败：' + (error?.message || error)); }
  finally { runningAction.value = false; }
}
const msg = ref("");
const pendingPrintedIds = ref([]);
const pendingPrintedCount = computed(() => pendingPrintedIds.value.length);

function clearDims() {
  invoiceStore.groupDims = [];
}
function dimOrder(key) {
  return invoiceStore.groupDims.indexOf(key);
}
function toggleDim(key) {
  const i = invoiceStore.groupDims.indexOf(key);
  if (i >= 0) invoiceStore.groupDims.splice(i, 1);
  else invoiceStore.groupDims.push(key);
}
const included = computed(() => orderedForPrint().map((x) => x.inv));
const summary = computed(() => invoiceSummary());
const blocked = computed(() => included.value.flatMap(inv => {
  const decision = invoiceActions.intakeDecision(inv);
  const reason = ['ready', 'saved'].includes(decision.state) ? invoiceProblems(inv.fields).join('、') : decision.reason;
  return reason ? [{ inv, reason }] : [];
}));
const examplePath = computed(() => {
  const invoice = included.value[0];
  return invoice ? ['./', ...groupPath(invoice), invoiceExportFileName(invoice, filenameTemplate.value)].join('/').replace('.//', './') : '';
});
function editInvoice(id) { open.value = false; emit('edit-invoice', id); }
function closeDialog(value) { if (!runningAction.value && !busy.value) open.value = value; }
function checkedCount(source) { return source.records.filter(row => props.fileMatches?.byRow.has(row.id)).length; }
async function exportCheckedWorkbook(source) {
  if (!checkedCount(source)) return;
  const stem = source.sourcePath.split('/').at(-1).replace(source.hasCheckedColumns ? /(?:_核对版(?:\(\d+\))?)?\.xlsx?$/i : /\.xlsx?$/i, '');
  const name = stem + '_核对版.xlsx';
  await saveWithDialog(buildCheckedInvoiceWorkbook(source, props.fileMatches.byRow), name, excelMime, '已保存核对版 Excel', '已下载核对版 Excel，请放到原 Excel 同级目录。');
}

async function makeLayout() {
  if (!included.value.length) {
    toastWarn("没有勾选要打印的发票。");
    return null;
  }
  busy.value = true;
  msg.value = "正在排版…";
  try {
    return await buildPrintLayout(included.value, { perPage: invoiceStore.perPage });
  } catch (e) {
    toastError("排版失败：" + ((e && e.message) || e));
    return null;
  } finally {
    busy.value = false;
  }
}

async function printNow() {
  if (!checkComplete()) return;
  const bytes = await makeLayout();
  if (bytes) {
    openForPrint(bytes);
    pendingPrintedIds.value = included.value.filter((inv) => inv.status === "done").map((inv) => inv.id);
    toastInfo(pendingPrintedIds.value.length
      ? "已调起打印，请在下方确认是否标记为已打印。"
      : "已调起打印。当前没有已识别发票可写入打印台账。");
  }
}

function confirmPrinted() {
  if (!checkComplete()) return;
  const stamp = new Date().toISOString().slice(0, 10);
  const result = invoiceActions.markPrinted(pendingPrintedIds.value, `打印_${stamp}`);
  pendingPrintedIds.value = [];
  toast(`已确认打印并写入台账：${result.printed} 张。`);
}

function cancelPrinted() {
  pendingPrintedIds.value = [];
  toastInfo("已取消本次打印标记。");
}

async function saveWithDialog(bytes, name, mime, okMsg, dlMsg) {
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) { toastInfo("已取消保存。"); return; }
    if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo(dlMsg); return; }
    toast(`${okMsg}：${r.saved}`);
  } catch (e) {
    if (e && e.name === "AbortError") toastInfo("已取消保存。");
    else { downloadBytes(bytes, name, mime); toastWarn("保存目录失败，已改为下载。"); }
  } finally {
    busy.value = false;
  }
}

function checkComplete() {
  if (!included.value.length) { toastWarn('请先勾选票据。'); return false; }
  if (!blocked.value.length) return true;
  open.value = true;
  return false;
}
async function downloadPdf() {
  if (!checkComplete()) return;
  const bytes = await makeLayout();
  if (!bytes) return;
  await saveWithDialog(bytes, `发票打印版_每页${invoiceStore.perPage}张.pdf`, "application/pdf", "已保存打印版 PDF", "已下载打印版 PDF。");
}
async function exportExcel() {
  if (!checkComplete()) return;
  if (!included.value.length) { toastWarn("没有勾选发票。"); return; }
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await saveWithDialog(buildInvoiceWorkbookBytes(included.value), "发票开票明细与汇总账单.xlsx", mime, "已保存 Excel", "已导出明细 + 汇总账单 Excel。");
}
async function exportReimburse() {
  if (!checkComplete()) return;
  if (!included.value.length) { toastWarn("没有勾选发票。"); return; }
  const repeated = included.value.filter(inv => inv.history?.entry?.reimbursement === "已报销");
  if (repeated.length && !await requestConfirmation("可能重复报销", `当前选择中有 ${repeated.length} 张发票已报销。仍要导出报销表吗？`, "继续导出")) return;
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await saveWithDialog(buildReimburseWorkbookBytes(included.value), reimburseWorkbookName(included.value), mime, "已保存财务费用报销表", "已导出财务费用报销表。");
}

async function exportPackage() {
  if (!checkComplete()) return;
  if (!included.value.length) { toastWarn("没有勾选发票。"); return; }
  if (!canUseTauriExport() && typeof window.showDirectoryPicker !== "function") {
    toastWarn("当前环境不能选择保存目录，请使用 Excel / PDF 下载。");
    return;
  }
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    appStorage.setItem("invoiceFilenameTemplate", filenameTemplate.value);
    appStorage.setItem("invoiceExportSort", exportSort.value);
    appStorage.setItem("invoiceExportDirection", exportDirection.value);
    const list = [...included.value];
    if (exportSort.value !== "original") list.sort((a, b) => {
      const key = exportSort.value;
      const av = a.fields?.[key] || "", bv = b.fields?.[key] || "";
      const cmp = key === "total" ? (Number(av) || 0) - (Number(bv) || 0) : String(av).localeCompare(String(bv), "zh-CN");
      return cmp * (exportDirection.value === "asc" ? 1 : -1);
    });
    const excelBytes = buildInvoiceWorkbookBytes(list);
    let result;
    if (canUseTauriExport()) {
      const dir = await pickTauriExportDir();
      if (!dir) { toastInfo("已取消导出。"); return; }
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackageTauri(list, dir, { excelBytes, dims: invoiceStore.groupDims, filenameTemplate: filenameTemplate.value });
    } else {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackage(list, dir, { excelBytes, dims: invoiceStore.groupDims, filenameTemplate: filenameTemplate.value });
    }
    toast(`已导出到「${result.parent}」：${result.fileCount} 个文件，统计表：${result.excelName || "未生成"}。`, { duration: 6500 });
  } catch (e) {
    if (e && e.name === "AbortError") toastInfo("已取消导出。");
    else toastError("整理导出失败：" + ((e && e.message) || e));
  } finally {
    busy.value = false;
  }
}

defineExpose({ exportExcel: () => runAction(exportExcel) });
</script>

<template>
  <DialogRoot :open="open" @update:open="closeDialog">
    <DialogPortal>
      <DialogOverlay class="ui-overlay print-layout-overlay" />
      <DialogContent class="print-layout-modal print-workbench" @interact-outside.prevent>
        <header class="print-layout-header">
          <div><DialogTitle class="print-layout-title">打印排版与批量导出</DialogTitle><DialogDescription class="print-layout-description">已勾选 {{ summary.count }} 张，价税合计 ¥{{ summary.total.toFixed(2) }}</DialogDescription></div>
          <DialogClose class="ui-btn" :disabled="busy || runningAction">关闭</DialogClose>
        </header>
        <section v-if="blocked.length" class="print-blocked mx-3 mt-3 rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-warn" aria-label="待核对票据">
          <strong>{{ blocked.length }} 张待修正，暂不能打印或导出</strong>
          <ul><li v-for="{ inv, reason } in blocked" :key="inv.id" class="flex items-center justify-between gap-2 py-1"><span>{{ inv.fields.seller || inv.name }}：{{ reason }}</span><button class="ui-btn-sm" @click="editInvoice(inv.id)">跳回修正</button></li></ul>
        </section>
        <div class="print-workbench-body">
          <section class="print-workbench-preview bg-bg p-3" aria-label="打印预览">
            <div class="ui-toolbar mb-3 min-h-11" role="group" aria-label="每页张数"><strong>每页</strong><button v-for="count in [1, 2, 4]" :key="count" class="ui-btn-sm" :class="{ 'bg-brand-soft text-brand': invoiceStore.perPage === count }" :aria-pressed="invoiceStore.perPage === count" @click="invoiceStore.perPage = count">{{ count }} 张</button></div>
            <InvoicePreview />
          </section>
          <section class="flex flex-col gap-3 p-3" aria-label="打印与导出选项">
            <div v-if="sourceWorkbooks.length" class="ui-section grid gap-2">
              <h3 class="font-semibold">核对版 Excel</h3><p class="text-xs text-ink-secondary">保留原表并追加相对链接。请将核对版保存到原 Excel 同级目录。</p>
              <div v-for="source in sourceWorkbooks" :key="source.sourcePath" class="flex items-center justify-between gap-2 border-t border-line pt-2"><div class="min-w-0"><p class="truncate" :title="source.sourcePath">{{ source.sourcePath }}</p><p class="text-xs text-ink-soft">已配对 {{ checkedCount(source) }} / {{ source.records.length }} 行</p></div><button class="ui-btn-sm" :disabled="busy || runningAction || !checkedCount(source)" @click="runAction(() => exportCheckedWorkbook(source))">导出核对版</button></div>
            </div>
            <div class="ui-section grid gap-2">
              <div class="flex items-center justify-between gap-2"><h3 class="font-semibold">目录分组</h3><button class="ui-btn-sm" :disabled="!invoiceStore.groupDims.length" @click="clearDims">清空分组</button></div>
              <p class="text-xs text-ink-secondary">点击顺序决定子目录层级；不选则平铺。</p>
              <div class="flex flex-wrap gap-1.5"><button v-for="dimension in GROUP_DIMENSIONS" :key="dimension.key" class="ui-btn-sm" :class="{ 'bg-brand-soft text-brand': dimOrder(dimension.key) >= 0 }" :aria-pressed="dimOrder(dimension.key) >= 0" @click="toggleDim(dimension.key)"><span v-if="dimOrder(dimension.key) >= 0" class="ui-badge-brand">{{ dimOrder(dimension.key) + 1 }}</span>{{ dimension.label }}</button></div>
              <label class="ui-label">文件名模板<input v-model="filenameTemplate" class="ui-input" /></label>
              <p v-if="examplePath" class="break-all rounded bg-surface p-2 text-xs text-ink-secondary" :title="examplePath">{{ examplePath }}</p>
              <p class="text-xs text-ink-soft">可用：{销售方} {日期} {金额} {购买方} {发票号码}</p>
              <div class="grid grid-cols-2 gap-2">
                <label class="ui-label">导出顺序<select v-model="exportSort" class="ui-input"><option value="original">当前顺序</option><option value="date">日期</option><option value="seller">销售方</option><option value="total">金额</option><option value="number">发票号码</option></select></label>
                <label class="ui-label">排序方向<select v-model="exportDirection" class="ui-input"><option value="asc">升序</option><option value="desc">降序</option></select></label>
              </div>
            </div>
            <div class="ui-section flex flex-wrap gap-2">
              <button class="ui-btn-primary" :disabled="busy || runningAction || !!blocked.length || !included.length || !!pendingPrintedCount" @click="runAction(printNow)">调起打印</button>
              <button class="ui-btn" :disabled="busy || runningAction || !!blocked.length || !included.length" @click="runAction(downloadPdf)">打印版 PDF</button>
              <button class="ui-btn" :disabled="busy || runningAction || !!blocked.length || !included.length" @click="runAction(exportExcel)">导出 Excel</button>
              <button class="ui-btn" :disabled="busy || runningAction || !!blocked.length || !included.length" @click="runAction(exportReimburse)">报销表</button>
              <button class="ui-btn" :disabled="busy || runningAction || !!blocked.length || !included.length" @click="runAction(exportPackage)">整理导出原件</button>
            </div>
            <div v-if="pendingPrintedCount" class="ui-section flex flex-wrap items-center gap-2"><span>本次 {{ pendingPrintedCount }} 张是否均已打印？</span><button class="ui-btn-primary" @click="runAction(confirmPrinted)">确认已打印并记账</button><button class="ui-btn" @click="cancelPrinted">暂不标记</button></div>
            <p v-if="busy && msg" role="status">{{ msg }}</p>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
</template>

<style scoped>
.print-workbench { width: min(1220px, 96vw); height: min(850px, 92dvh); }
.print-blocked { max-height: 22dvh; overflow: auto; }
.print-workbench-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(290px, 360px); }
.print-workbench-body > section { overflow: auto; min-width: 0; }
.print-workbench-preview { border-right: 1px solid #e3e6ea; }
@media (max-width: 700px) { .print-workbench-body { display: block; overflow: auto; } .print-workbench-body > section { overflow: visible; } }
</style>

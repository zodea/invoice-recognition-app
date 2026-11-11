<script setup>
import { invoiceProblems } from "../lib/invoice-review";
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from "vue";
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
  RadioGroupIndicator,
  RadioGroupItem,
  RadioGroupRoot,
} from "reka-ui";
import { invoiceStore, invoiceActions, invoiceSummary, orderedForPrint } from "../invoiceStore";
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
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

const filenameTemplate = ref(localStorage.getItem("invoiceFilenameTemplate") || "{销售方}：{日期}={金额}元");
const exportSort = ref(localStorage.getItem("invoiceExportSort") || "original");
const exportDirection = ref(localStorage.getItem("invoiceExportDirection") || "asc");
const busy = ref(false);
const dockRef = ref(null);
const activePanel = ref("");
const runningAction = ref(false);
function closeDockPanels() {
  activePanel.value = "";
  dimsOpen.value = false;
}
function toggleDockPanel(panel) {
  dimsOpen.value = false;
  activePanel.value = activePanel.value === panel ? "" : panel;
}
function onOutsideInteraction(event) {
  if (dockRef.value?.contains(event.target)) return;
  if (event.target?.closest?.('[data-print-dimensions]')) return;
  closeDockPanels();
}
function onEscape(event) {
  if (event.key !== "Escape") return;
  if (dimsOpen.value) dimsOpen.value = false;
  else closeDockPanels();
}
onMounted(() => {
  document.addEventListener("pointerdown", onOutsideInteraction, true);
  document.addEventListener("focusin", onOutsideInteraction);
  document.addEventListener("keydown", onEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onOutsideInteraction, true);
  document.removeEventListener("focusin", onOutsideInteraction);
  document.removeEventListener("keydown", onEscape);
});
async function runDockAction(action) {
  if (runningAction.value || busy.value) return;
  closeDockPanels();
  runningAction.value = true;
  try {
    await nextTick();
    await action();
  } catch (error) {
    toastError("操作失败：" + (error?.message || error));
  } finally {
    runningAction.value = false;
  }
}
const msg = ref("");
const pendingPrintedIds = ref([]);
const pendingPrintedCount = computed(() => pendingPrintedIds.value.length);

// 每页张数：reka RadioGroup 用字符串值，这里做 number<->string 代理
const perPageStr = computed({
  get: () => String(invoiceStore.perPage),
  set: (v) => { invoiceStore.perPage = Number(v); },
});

// 分目录维度多选。点选先后即文件夹嵌套顺序，序号在标签上体现。
// 打开时快照，确认=保留、取消=还原、清空=取消所有维度；点外面/Esc 关闭按保留处理。
const dimsOpen = ref(false);
let dimsBackup = [];
function onDimsOpen(open) {
  if (open) dimsBackup = [...invoiceStore.groupDims];
  dimsOpen.value = open;
}
function confirmDims() {
  dimsOpen.value = false;
}
function cancelDims() {
  invoiceStore.groupDims = [...dimsBackup];
  dimsOpen.value = false;
}
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
const dimsLabel = computed(() => {
  if (!invoiceStore.groupDims.length) return "不分目录";
  return invoiceStore.groupDims
    .map((k) => GROUP_DIMENSIONS.find((d) => d.key === k)?.label || k)
    .join(" / ");
});

const included = computed(() => orderedForPrint().map((x) => x.inv));
const summary = computed(() => invoiceSummary());
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
 const blocked = included.value.filter(inv=>!['ready','saved'].includes(invoiceActions.intakeDecision(inv).state));
 if(blocked.length){toastWarn('有 '+blocked.length+' 张票据尚未确认入账去向：'+invoiceActions.intakeDecision(blocked[0]).reason);return false;}
 const bad=included.value.filter(inv=>invoiceProblems(inv.fields).length);
 if(!bad.length)return true;
 toastWarn('有 '+bad.length+' 张票据未通过复核，不能保存：'+invoiceProblems(bad[0].fields).join('、')); return false;
}
async function downloadPdf() {
  if (!checkComplete()) return;
  const bytes = await makeLayout();
  if (!bytes) return;
  await saveWithDialog(bytes, `发票打印版_每页${invoiceStore.perPage}张.pdf`, "application/pdf", "已保存打印版 PDF", "已下载打印版 PDF。");
}
async function exportExcel() {
  if (!checkComplete()) return;
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await saveWithDialog(buildInvoiceWorkbookBytes(included.value), "发票开票明细与汇总账单.xlsx", mime, "已保存 Excel", "已导出明细 + 汇总账单 Excel。");
}
async function exportReimburse() {
  if (!checkComplete()) return;
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
  const repeated = included.value.filter(inv => inv.history?.entry?.reimbursement === "已报销");
  if (repeated.length && !window.confirm(`当前选择中有 ${repeated.length} 张发票已报销，可能重复报销。仍要导出报销表吗？`)) return;
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await saveWithDialog(buildReimburseWorkbookBytes(included.value), reimburseWorkbookName(included.value), mime, "已保存财务费用报销表", "已导出财务费用报销表。");
}

async function exportPackage() {
  if (!checkComplete()) return;
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
  if (!canUseTauriExport() && typeof window.showDirectoryPicker !== "function") {
    window.alert("当前运行环境不支持直接选择保存目录，请先使用 Excel / PDF 下载。");
    return;
  }
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    localStorage.setItem("invoiceFilenameTemplate", filenameTemplate.value);
    localStorage.setItem("invoiceExportSort", exportSort.value);
    localStorage.setItem("invoiceExportDirection", exportDirection.value);
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

</script>

<template>
  <section ref="dockRef" class="print-dock" aria-label="打印与导出">
    <div class="print-dock-summary"><span>已勾选 <strong>{{ summary.count }}</strong> 张</span><span>价税合计 <strong class="print-total">¥{{ summary.total.toFixed(2) }}</strong></span><span class="print-tax">税额 ¥{{ summary.tax.toFixed(2) }}</span></div>
    <div class="print-dock-actions">
      <details class="dock-popover print-options" :open="activePanel === 'settings'"><summary class="dock-button" :aria-expanded="activePanel === 'settings'" @click.prevent="toggleDockPanel('settings')">打印与导出设置</summary><div class="dock-popover-content print-options-content">
        <div class="print-options-heading"><strong>打印与导出设置</strong><span>调整后对当前选中发票生效</span></div>
        <div class="print-options-grid">
          <div class="print-option"><span class="print-option-label">每页张数</span><RadioGroupRoot v-model="perPageStr" class="print-page-options"><label v-for="n in [1, 2, 4]" :key="n"><RadioGroupItem :value="String(n)" class="print-page-radio"><RadioGroupIndicator class="print-page-indicator" /></RadioGroupItem>{{ n }} 张</label></RadioGroupRoot></div>
          <div class="print-option"><span class="print-option-label">分目录</span><PopoverRoot :open="dimsOpen" @update:open="onDimsOpen"><PopoverTrigger class="btn print-dim-trigger">{{ dimsLabel }} <span aria-hidden="true">▾</span></PopoverTrigger><PopoverPortal><PopoverContent data-print-dimensions align="start" :side-offset="4" class="z-60 min-w-55 bg-white border border-line-strong rounded-lg shadow-card p-2 flex flex-col gap-1"><p class="m-0 mb-1 text-[11px] text-ink-soft">勾选顺序即文件夹层级；左右两栏同步分组</p><label v-for="d in GROUP_DIMENSIONS" :key="d.key" class="flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer text-ink hover:bg-brand-soft"><input type="checkbox" :checked="dimOrder(d.key) >= 0" @change="toggleDim(d.key)" /><span v-if="dimOrder(d.key) >= 0" class="min-w-4.5 h-4.5 inline-flex items-center justify-center rounded-full bg-brand text-white text-[11px] font-800">{{ dimOrder(d.key) + 1 }}</span>{{ d.label }}</label><div class="flex items-center gap-1.5 mt-1.5 pt-1.5 border-t border-line"><button type="button" class="btn-primary px-2.5 py-1 text-xs" @click="confirmDims">确认</button><button type="button" class="btn px-2.5 py-1 text-xs" @click="cancelDims">取消</button><button type="button" class="btn-danger px-2.5 py-1 text-xs ml-auto" :disabled="!invoiceStore.groupDims.length" @click="clearDims">清空</button></div></PopoverContent></PopoverPortal></PopoverRoot></div>
          <label class="print-option print-name"><span class="print-option-label">文件名格式</span><input v-model="filenameTemplate" class="field-input" /></label>
          <label class="print-option"><span class="print-option-label">导出顺序</span><select v-model="exportSort" class="field-input"><option value="original">当前顺序</option><option value="date">日期</option><option value="seller">销售方</option><option value="total">金额</option><option value="number">发票号码</option></select></label>
          <label class="print-option"><span class="print-option-label">排序方向</span><select v-model="exportDirection" class="field-input"><option value="asc">升序</option><option value="desc">降序</option></select></label>
        </div>
        <p class="print-option-hint">文件名可用：{销售方} {日期} {金额} {购买方} {发票号码}。</p>
      </div></details>
      <button class="btn-primary" :disabled="busy || runningAction || !included.length" @click="runDockAction(printNow)">打印</button>
      <button class="btn" :disabled="busy || runningAction || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="runDockAction(exportExcel)">导出 Excel</button>
      <details class="dock-popover export-menu" :open="activePanel === 'export'"><summary class="dock-button" :aria-expanded="activePanel === 'export'" @click.prevent="toggleDockPanel('export')">更多导出 ▾</summary><div class="dock-popover-content export-menu-content"><button class="export-menu-item" :disabled="busy || runningAction || !included.length || !hasRecognized" @click="runDockAction(downloadPdf)">导出打印版 PDF</button><button class="export-menu-item" :disabled="busy || runningAction || !included.length || !hasRecognized" @click="runDockAction(exportPackage)">整理导出原文件</button><button class="export-menu-item" :disabled="busy || runningAction || !included.length || !hasRecognized" @click="runDockAction(exportReimburse)">导出财务费用报销表</button></div></details>
    </div>
    <div v-if="busy && msg" class="print-dock-notice" role="status">{{ msg }}</div>
    <div v-if="pendingPrintedCount" class="print-dock-confirm"><span>本次 {{ pendingPrintedCount }} 张是否均已打印？</span><button class="btn" :disabled="busy" @click="confirmPrinted">确认已打印</button><button class="btn" :disabled="busy" @click="cancelPrinted">暂不标记</button></div>
  </section>
</template>

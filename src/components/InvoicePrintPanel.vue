<script setup>
import { ref, computed } from "vue";
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

const busy = ref(false);
const msg = ref("");
const pendingPrintedIds = ref([]);
const pendingPrintedCount = computed(() => pendingPrintedIds.value.length);

// 每页张数：reka RadioGroup 用字符串值，这里做 number<->string 代理
const perPageStr = computed({
  get: () => String(invoiceStore.perPage),
  set: (v) => { invoiceStore.perPage = Number(v); },
});

// 分目录维度多选。点选先后即文件夹嵌套顺序，序号在标签上体现。
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
    pendingPrintedIds.value = included.value.filter((inv) => inv.status === "done").map((inv) => inv.id);
    msg.value = pendingPrintedIds.value.length
      ? "已调起打印。打印完成后请确认是否把本次发票标记为已打印。"
      : "已调起打印。当前没有已识别发票可写入打印台账。";
  }
}

function confirmPrinted() {
  const stamp = new Date().toISOString().slice(0, 10);
  const result = invoiceActions.markPrinted(pendingPrintedIds.value, `打印_${stamp}`);
  pendingPrintedIds.value = [];
  msg.value = `已确认打印并写入台账：${result.printed} 张。`;
}

function cancelPrinted() {
  pendingPrintedIds.value = [];
  msg.value = "已取消本次打印标记。";
}

async function saveWithDialog(bytes, name, mime, okMsg, dlMsg) {
  busy.value = true;
  msg.value = "请选择保存目录…";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) { msg.value = "已取消保存。"; return; }
    if (r.fallbackDownload) { downloadBytes(bytes, name, mime); msg.value = dlMsg; return; }
    msg.value = `${okMsg}：${r.saved}`;
  } catch (e) {
    if (e && e.name === "AbortError") msg.value = "已取消保存。";
    else { downloadBytes(bytes, name, mime); msg.value = "保存目录失败，已改为下载。"; }
  } finally {
    busy.value = false;
  }
}

async function downloadPdf() {
  const bytes = await makeLayout();
  if (!bytes) return;
  await saveWithDialog(bytes, `发票打印版_每页${invoiceStore.perPage}张.pdf`, "application/pdf", "已保存打印版 PDF", "已下载打印版 PDF。");
}
async function exportExcel() {
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await saveWithDialog(buildInvoiceWorkbookBytes(included.value), "发票开票明细与汇总账单.xlsx", mime, "已保存 Excel", "已导出明细 + 汇总账单 Excel。");
}
async function exportReimburse() {
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  await saveWithDialog(buildReimburseWorkbookBytes(included.value), reimburseWorkbookName(included.value), mime, "已保存财务费用报销表", "已导出财务费用报销表。");
}

async function exportPackage() {
  if (!included.value.length) { window.alert("没有勾选发票。"); return; }
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
      if (!dir) { msg.value = "已取消导出。"; return; }
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackageTauri(included.value, dir, { excelBytes, dims: invoiceStore.groupDims });
    } else {
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      msg.value = "正在整理原文件和统计表…";
      result = await writeInvoiceExportPackage(included.value, dir, { excelBytes, dims: invoiceStore.groupDims });
    }
    msg.value = `已导出到「${result.parent}」：${result.fileCount} 个文件，统计表：${result.excelName || "未生成"}。`;
  } catch (e) {
    if (e && e.name === "AbortError") msg.value = "已取消导出。";
    else msg.value = "整理导出失败：" + ((e && e.message) || e);
  } finally {
    busy.value = false;
  }
}

const exportBtnCls = "btn px-2.75 py-1.75 text-[13px]";
</script>

<template>
  <div class="panel p-2.5">
    <div class="flex gap-3 flex-wrap text-ink-soft mb-2">
      <span>勾选 <b class="text-ink text-[15px]">{{ summary.count }}</b> 张</span>
      <span>价税合计 <b class="text-brand text-[15px]">{{ summary.total.toFixed(2) }}</b></span>
      <span>税额 <b class="text-ink text-[15px]">{{ summary.tax.toFixed(2) }}</b></span>
    </div>

    <div class="flex items-center justify-between gap-2.5 flex-wrap">
      <div class="flex items-center gap-2.25 flex-wrap text-ink-soft">
        <span>每页</span>
        <RadioGroupRoot v-model="perPageStr" class="flex items-center gap-2.5">
          <label v-for="n in [1, 2, 4]" :key="n" class="inline-flex items-center gap-1.5 cursor-pointer text-ink">
            <RadioGroupItem
              :value="String(n)"
              class="w-4 h-4 rounded-full border border-line-strong bg-white grid place-items-center data-[state=checked]:border-brand"
            >
              <RadioGroupIndicator class="w-2 h-2 rounded-full bg-brand" />
            </RadioGroupItem>
            {{ n }}张
          </label>
        </RadioGroupRoot>

        <PopoverRoot v-model:open="dimsOpen">
          <PopoverTrigger class="btn px-2.5 py-1.5 text-ink">
            分目录：<b class="text-brand font-800">{{ dimsLabel }}</b> <span class="text-ink-soft">▾</span>
          </PopoverTrigger>
          <PopoverPortal>
            <PopoverContent
              align="start"
              :side-offset="4"
              class="z-30 min-w-55 bg-white border border-line-strong rounded-lg shadow-card p-2 flex flex-col gap-1"
            >
              <p class="m-0 mb-1 text-[11px] text-ink-soft">勾选顺序即文件夹层级；左右两栏同步分组</p>
              <label
                v-for="d in GROUP_DIMENSIONS"
                :key="d.key"
                class="flex items-center gap-1.5 px-1.5 py-1 rounded-md cursor-pointer text-ink hover:bg-brand-soft"
              >
                <input type="checkbox" :checked="dimOrder(d.key) >= 0" @change="toggleDim(d.key)" />
                <span v-if="dimOrder(d.key) >= 0" class="min-w-4.5 h-4.5 inline-flex items-center justify-center rounded-full bg-brand text-white text-[11px] font-800">{{ dimOrder(d.key) + 1 }}</span>
                {{ d.label }}
              </label>
              <button type="button" class="mt-1 border-none bg-none text-left px-1.5 py-1 text-xs text-ink-soft hover:text-danger" @click="invoiceStore.groupDims.splice(0)">清除分目录</button>
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>

      <div class="flex gap-2 flex-wrap">
        <button class="btn-primary px-2.75 py-1.75 text-[13px]" :disabled="busy || !included.length" @click="printNow">打印</button>
        <button :class="exportBtnCls" :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="downloadPdf">PDF</button>
        <button :class="exportBtnCls" :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="exportExcel">Excel</button>
        <button :class="exportBtnCls" :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="exportPackage">整理导出</button>
        <button :class="exportBtnCls" :disabled="busy || !included.length || !hasRecognized" :title="!hasRecognized ? '请先识别后再导出' : ''" @click="exportReimburse">财务费用报销导出</button>
      </div>
    </div>

    <div class="mt-2 text-ink-soft text-[13px]" v-if="msg">{{ msg }}</div>
    <div v-if="pendingPrintedCount" class="mt-2 flex items-center gap-2 flex-wrap p-2 rounded-md border border-[#bbf7d0] bg-[#f0fdf4] text-[#166534] text-[13px]">
      <span>本次 {{ pendingPrintedCount }} 张是否均已打印？</span>
      <button class="btn px-2 py-1.25 border-ok bg-ok text-white" :disabled="busy" @click="confirmPrinted">确认已打印</button>
      <button class="btn px-2 py-1.25" :disabled="busy" @click="cancelPrinted">暂不标记</button>
    </div>
  </div>
</template>

<script setup>
import ImportFileDialog from './ImportFileDialog.vue';
import ExpenseAssignmentImport from './ExpenseAssignmentImport.vue';
import ConfirmAction from './ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
import { computed, ref } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem } from "reka-ui";
const expenseImportOpen = ref(false);
import { invoiceStore, invoiceActions } from "../invoiceStore.js";
import { buildCurrentInputInvoiceReportBytes, buildHistoryReportBytes, currentInputReportName, historyReportName, ledgerStats } from "../lib/invoice-ledger";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { downloadBytes } from "../lib/file-utils.js";
import ExpenseImportReview from "./ExpenseImportReview.vue";
import InvoiceReconciliation from "./InvoiceReconciliation.vue";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

const reconciliationOpen = ref(false);

const busy = ref(false);
const dragging = ref(false);
const msg = ref("");
const stats = computed(() => ledgerStats(invoiceStore.ledger));


async function importLedgerFiles(files) {
  const excel = Array.from(files || []).filter(f => /\.(xlsx|xls)$/i.test(f.name) && !f.name.startsWith("~$"));
  if (!excel.length) { toastWarn("没有找到可导入的 Excel 文件。"); return; }
  busy.value = true;
  let imported = 0, added = 0, updated = 0, failed = 0;
  try {
    for (const [index, file] of excel.entries()) {
      msg.value = `正在导入 ${index + 1}/${excel.length}：${file.name}`;
      try { const r = await invoiceActions.importInputInvoiceReport(file); imported += r.imported; added += r.added; updated += r.updated; }
      catch (err) { failed++; console.error(file.name, err); }
    }
    if (failed) toastWarn(`导入完成：${excel.length - failed} 个文件成功，${failed} 个失败；识别 ${imported} 条。`);
    else toast(`已导入 ${excel.length} 个文件，识别 ${imported} 条，新增 ${added} 条，更新 ${updated} 条。`);
  } finally { busy.value = false; }
}

async function saveLedgerBytes(bytes, name, okMsg, dlMsg) {
  busy.value = true;
  msg.value = "请选择保存目录…";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) toastInfo("已取消导出。");
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo(dlMsg); }
    else toast(`${okMsg}：${r.saved}`);
  } catch (err) {
    if (err && err.name === "AbortError") toastInfo("已取消导出。");
    else { downloadBytes(bytes, name, mime); toastWarn("保存目录失败，已改为下载。"); }
  } finally {
    busy.value = false;
  }
}

async function exportHistory() {
  if (!stats.value.total) { toastWarn("当前还没有历史进项发票台账。"); return; }
  await saveLedgerBytes(buildHistoryReportBytes(invoiceStore.ledger), historyReportName(), "已保存历史台账", "已导出历史台账。");
}

async function exportCurrentInputStatus() {
  if (!invoiceStore.invoices.length) { toastWarn("当前还没有导入发票。"); return; }
  await saveLedgerBytes(buildCurrentInputInvoiceReportBytes(invoiceStore.invoices, invoiceStore.ledger), currentInputReportName(), "已保存当前进项发票状态", "已导出当前进项发票状态。");
}

async function onDrop(e) {
  dragging.value = false;
  if (!busy.value) await importLedgerFiles(e.dataTransfer?.files);
}

async function clearLedger() {
  if (!stats.value.total) return;
  const ok = await requestConfirmation('清空历史台账',
    `确认清空历史进项台账吗？\n\n当前共有 ${stats.value.total} 张历史记录。这些记录将移入回收站，暂不参与汇总和查重；原件保留，可在发票列表的回收站中恢复。`
  );
  if (!ok) { toastInfo("已取消清空。"); return; }
  try { invoiceActions.clearLedger(); toast(invoiceStore.msg); }
  catch (error) { toastError("清空失败，原记录仍保留：" + error.message); }
}
</script>

<template>
  <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
  <section class="ui-toolbar min-h-11 gap-2 overflow-x-auto py-1" :class="{ 'border-brand bg-brand-soft': dragging }"
    @dragenter.prevent="dragging = true" @dragover.stop.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.stop.prevent="onDrop">
    <h2 class="shrink-0 whitespace-nowrap text-sm font-semibold">历史进项台账</h2>
    <div class="flex min-w-max items-center gap-1.5">
      <ImportFileDialog label="导入进项 Excel" accept=".xlsx,.xls" multiple primary compact :disabled="busy" @files="importLedgerFiles" />
      <button class="ui-btn" @click="expenseImportOpen = true">导入报销记录</button>
      <ExpenseAssignmentImport compact />
      <button class="ui-btn" :disabled="!stats.total" @click="reconciliationOpen = true">历史报销核对</button>
      <DropdownMenuRoot :modal="false">
        <DropdownMenuTrigger class="ui-btn" :disabled="busy">导出与管理</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent class="ui-popover z-45 grid min-w-42 gap-1 p-1" align="end" :side-offset="6">
            <DropdownMenuItem class="ui-btn-ghost justify-start" :disabled="!stats.total" @select="exportHistory">导出历史台账</DropdownMenuItem>
            <DropdownMenuItem class="ui-btn-ghost justify-start" :disabled="!invoiceStore.invoices.length" @select="exportCurrentInputStatus">导出当前进项状态</DropdownMenuItem>
            <DropdownMenuItem class="ui-btn-ghost justify-start text-danger" :disabled="!stats.total" @select="clearLedger">清空历史台账</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenuRoot>
    </div>
    <span v-if="dragging || busy" class="min-w-0 truncate text-xs text-brand-deep" role="status" :title="msg">{{ dragging ? '松开即可导入进项 Excel' : msg }}</span>
  </section>
  <InvoiceReconciliation v-model:open="reconciliationOpen" />
  <DialogRoot v-model:open="expenseImportOpen">
    <DialogPortal><DialogOverlay class="ui-overlay z-60" />
      <DialogContent class="ui-dialog z-61 w-[min(1000px,94vw)] max-h-[84vh] p-4">
        <header class="flex items-center justify-between gap-2"><DialogTitle class="text-base font-semibold">导入报销记录</DialogTitle><button class="ui-btn" @click="expenseImportOpen = false">关闭</button></header>
        <DialogDescription class="text-xs text-ink-secondary">选择报销表，核对匹配结果后确认导入。</DialogDescription>
        <ExpenseImportReview standalone />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

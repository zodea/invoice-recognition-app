<script setup>
import ConfirmAction from './ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
import { computed, ref } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
const expenseImportOpen = ref(false);
import { invoiceStore, invoiceActions } from "../invoiceStore";
import { buildCurrentInputInvoiceReportBytes, buildHistoryReportBytes, currentInputReportName, historyReportName, ledgerStats } from "../lib/invoice-ledger";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { downloadBytes } from "../lib/file-utils.js";
import ExpenseImportReview from "./ExpenseImportReview.vue";
import InvoiceReconciliation from "./InvoiceReconciliation.vue";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

defineProps({ ledgerPage: Boolean });
const emit = defineEmits(["open-ledger"]);
const reconciliationOpen = ref(false);

const fileRef = ref(null);
const expenseRef = ref(null);
const busy = ref(false);
const dragging = ref(false);
const msg = ref("");
const stats = computed(() => ledgerStats(invoiceStore.ledger));

function chooseFile() {
  fileRef.value?.click();
}

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
  if (!stats.value.total) { window.alert("当前还没有历史进项发票台账。"); return; }
  await saveLedgerBytes(buildHistoryReportBytes(invoiceStore.ledger), historyReportName(), "已保存历史台账", "已导出历史台账。");
}

async function exportCurrentInputStatus() {
  if (!invoiceStore.invoices.length) { window.alert("当前还没有导入发票。"); return; }
  await saveLedgerBytes(buildCurrentInputInvoiceReportBytes(invoiceStore.invoices, invoiceStore.ledger), currentInputReportName(), "已保存当前进项发票状态", "已导出当前进项发票状态。");
}

async function importReport(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  await importLedgerFiles(files);
}
async function importExpenses(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  busy.value = true;
  let added = 0, updated = 0, conflicts = 0, skipped = 0, failed = 0;
  try {
    for (const file of files) {
      msg.value = `正在读取：${file.name}`;
      try { const r = await invoiceActions.importExpenseReport(file); added += r.added; updated += r.updated; conflicts += r.conflicts; skipped += r.skipped; }
      catch (err) { failed++; console.error(file.name, err); }
    }
    const result = `报销表导入：新增 ${added} 条，补充 ${updated} 条；${conflicts} 条冲突、${skipped} 条号码不完整需核对${failed ? `，${failed} 个文件读取失败` : ""}。`;
    if (conflicts || skipped || failed) toastWarn(result); else toast(result);
    msg.value = result;
  } finally { busy.value = false; }
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
  <section
    class="panel ledger-panel p-2.5 transition-colors"
    :class="dragging ? '!border-brand bg-brand-soft shadow-[0_0_0_2px_rgba(37,99,235,0.16)]' : ''"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="fileRef" class="hidden" type="file" accept=".xlsx,.xls" multiple @change="importReport" />
    <input ref="expenseRef" class="hidden" type="file" accept=".xlsx,.xls" multiple @change="importExpenses" />
    <div class="ledger-heading">
      <div>
        <h2 class="m-0 text-[15px] font-700">历史进项台账</h2>
        <p v-if="!ledgerPage" class="mt-0.5 text-ink-soft text-xs leading-relaxed">拖入或选择税务局进项发票清单，记录官方勾选状态，并核对历史报销。</p>
      </div>
    <div class="ledger-stats text-ink-soft text-xs">
      <span><b class="text-ink text-[15px]">{{ stats.total }}</b> 张</span>
      <span><b class="text-ink text-[15px]">{{ stats.verified }}</b> 已抵税</span>
      <span><b class="text-ink text-[15px]">{{ stats.printed }}</b> 已打印</span>
    </div>
    </div>
    <div
      v-if="!ledgerPage || dragging"
      class="mt-2 p-2 border border-dashed rounded-md text-xs font-700 transition-colors"
      :class="dragging ? 'border-brand bg-white text-brand' : 'border-line-strong bg-[#f8fafc] text-ink-soft'"
    >
      {{ dragging ? "松开即可导入进项 Excel" : "可拖拽 .xlsx / .xls 到这里导入" }}
    </div>
    <div class="ledger-panel-actions">
      <button class="btn-primary px-2.5 py-1.75" :disabled="busy" @click="chooseFile">导入进项 Excel</button>

      <button v-if="!ledgerPage" class="btn px-2.5 py-1.75" @click="emit('open-ledger')">打开台账页面</button>
      <button class="btn" @click="expenseImportOpen = true">导入报销记录</button>
      <button class="btn px-2.5 py-1.75" :disabled="!stats.total" @click="reconciliationOpen = true">历史报销核对</button>
      <button class="btn px-2.5 py-1.75" :disabled="busy || !stats.total" @click="exportHistory">导出历史台账</button>
      <button class="btn px-2.5 py-1.75" :disabled="busy || !invoiceStore.invoices.length" @click="exportCurrentInputStatus">导出当前进项状态</button>
      <button class="btn px-2.5 py-1.75 border-[#fecaca] text-[#991b1b] bg-[#fef2f2]" :disabled="busy || !stats.total" @click="clearLedger">清空历史台账</button>
    </div>
    <div class="mt-2 text-ink-soft text-xs" v-if="msg" role="status">{{ msg }}</div>
    <InvoiceReconciliation v-model:open="reconciliationOpen" />
    <DialogRoot v-model:open="expenseImportOpen"><DialogPortal><DialogOverlay class="expense-overlay" /><DialogContent class="expense-dialog">
      <header><DialogTitle>导入报销记录</DialogTitle><button class="btn" @click="expenseImportOpen=false">关闭</button></header>
      <DialogDescription>选择报销表，核对匹配结果后确认导入。</DialogDescription>
      <ExpenseImportReview standalone />
    </DialogContent></DialogPortal></DialogRoot>
  </section>
</template>

<style scoped>
.ledger-panel{padding:8px 12px}.ledger-heading{display:flex;align-items:center;gap:18px;flex-wrap:wrap;margin-bottom:6px}.ledger-stats{display:flex;gap:12px}.ledger-panel-actions{display:flex;gap:6px;flex-wrap:wrap}.ledger-panel-actions button{min-height:30px;padding:4px 9px;font-size:12px}
.expense-overlay{position:fixed;inset:0;background:#0f172a66;z-index:60}.expense-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1000px,94vw);max-height:84vh;overflow:auto;z-index:61;background:white;border-radius:10px;padding:18px;outline:none}.expense-dialog header{display:flex;align-items:center;justify-content:space-between;gap:12px}.expense-dialog h2{margin:0;font-size:18px}.expense-dialog p{color:#64748b;font-size:12px}
</style>

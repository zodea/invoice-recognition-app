<script setup>
import { computed, nextTick, watch } from "vue";
import { invoiceStore, invoiceActions, sortedInvoices, buyerOptions, docTypeOptions } from "../invoiceStore";
import InvoiceUpload from "../components/InvoiceUpload.vue";
import InvoicePreview from "../components/InvoicePreview.vue";
import InvoiceRow from "../components/InvoiceRow.vue";
import InvoicePrintPanel from "../components/InvoicePrintPanel.vue";
import InvoiceLedgerPanel from "../components/InvoiceLedgerPanel.vue";
import { toast, toastInfo } from "../lib/toast";

const sorted = computed(() => sortedInvoices());
const unrecognizedCount = computed(() => invoiceStore.invoices.filter((i) => i.status !== "done").length);
const duplicateCount = computed(() => invoiceStore.invoices.filter((i) => i.duplicateReason).length);
// 历史已用/已认证（台账查重）：勾选中且历史已用的张数，可一键排除以避免重复使用
const reusedIncludedCount = computed(() => invoiceStore.invoices.filter((i) => i.include && i.history && i.history.usedBefore).length);
const buyers = computed(() => buyerOptions());
const docTypes = computed(() => docTypeOptions());

function dedupe() {
  const n = invoiceActions.refreshDuplicates();
  if (n) toast(`已识别并取消勾选 ${n} 张重复发票。`);
  else toastInfo("未发现重复发票。");
}
function excludeReused() {
  const n = invoiceActions.excludeReused(visibleInvs.value);
  if (n) toast(`已排除 ${n} 张历史已用发票（避免重复使用）。`);
  else toastInfo("勾选中没有历史已用的发票。");
}

// 打印勾选批量操作：作用于当前筛选后可见的发票
const visibleInvs = computed(() => sorted.value.map((x) => x.inv));
function selectAll() {
  invoiceActions.setIncludeAll(visibleInvs.value, true);
  toastInfo(`已全选 ${visibleInvs.value.length} 张。`, { duration: 2000 });
}
function selectNone() {
  invoiceActions.setIncludeAll(visibleInvs.value, false);
  toastInfo("已全部取消勾选。", { duration: 2000 });
}
function invertSelect() {
  invoiceActions.invertInclude(visibleInvs.value);
  toastInfo("已反选。", { duration: 2000 });
}

watch(
  () => invoiceStore.selectedId,
  async (id) => {
    if (!id) return;
    await nextTick();
    const safe = window.CSS?.escape ? window.CSS.escape(id) : id.replace(/"/g, '\\"');
    document.querySelectorAll(`[data-inv="${safe}"]`).forEach((el) => {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    });
  }
);

const filterBtn = (active) =>
  active
    ? "border border-brand bg-brand-soft text-brand rounded-full px-2.25 py-1 text-xs font-700"
    : "border border-line bg-white text-ink rounded-full px-2.25 py-1 text-xs font-700 hover:border-brand";
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid gap-3 items-stretch grid-cols-[minmax(300px,0.9fr)_minmax(420px,1.1fr)_minmax(300px,0.8fr)] lt-lg:grid-cols-1">
      <InvoiceUpload />
      <InvoicePrintPanel />
      <InvoiceLedgerPanel />
    </div>

    <div v-if="invoiceStore.invoices.length" class="flex items-center gap-2.5 flex-wrap px-2.5 py-2 border border-line rounded-lg bg-white">
      <div class="text-ink-soft">
        <strong class="text-ink">{{ invoiceStore.invoices.length }}</strong> 张发票
        <span v-if="unrecognizedCount">，{{ unrecognizedCount }} 张未识别</span>
        <span v-else>，全部已识别</span>
        <span v-if="duplicateCount" class="ml-2 chip text-[#991b1b] bg-[#fef2f2] border border-[#fecaca] px-2 py-0.5">含 {{ duplicateCount }} 张重复(已排除)</span>
        <span v-if="reusedIncludedCount" class="ml-2 chip text-[#92400e] bg-[#fffbeb] border border-[#fde68a] px-2 py-0.5">勾选中 {{ reusedIncludedCount }} 张历史已用</span>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn-primary px-2.5 py-1.5" :disabled="invoiceStore.busy || !unrecognizedCount" @click="invoiceActions.recognizeAll">
          {{ invoiceStore.busy ? "识别中…" : "全部识别" }}
        </button>
        <button class="btn px-2.5 py-1.5" :disabled="invoiceStore.busy || invoiceStore.invoices.length < 2" @click="dedupe">去重</button>
        <button class="btn px-2.5 py-1.5" :disabled="!reusedIncludedCount" :title="'排除历史台账里已认证/已报销过的发票，避免重复使用'" @click="excludeReused">排除历史已用{{ reusedIncludedCount ? ` (${reusedIncludedCount})` : "" }}</button>
        <button class="btn-ghost px-2.5 py-1.5" @click="invoiceActions.clearAll">清空</button>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="text-ink-soft text-xs">打印勾选</span>
        <button class="btn px-2.5 py-1.5" @click="selectAll">全选</button>
        <button class="btn px-2.5 py-1.5" @click="invertSelect">反选</button>
        <button class="btn px-2.5 py-1.5" @click="selectNone">全不选</button>
      </div>
      <span class="text-ink-soft" v-if="invoiceStore.busy && invoiceStore.msg">{{ invoiceStore.msg }}</span>
    </div>

    <div v-if="invoiceStore.invoices.length" class="flex flex-col gap-2 px-2.5 py-2.5 border border-line rounded-lg bg-white">
      <div class="flex items-center gap-1.75 flex-wrap">
        <span class="flex-none text-ink-soft font-700 text-xs">购买方</span>
        <button v-for="buyer in buyers" :key="buyer" :class="filterBtn(invoiceStore.buyerFilter === buyer)" @click="invoiceStore.buyerFilter = buyer">{{ buyer }}</button>
      </div>
      <div class="flex items-center gap-1.75 flex-wrap">
        <span class="flex-none text-ink-soft font-700 text-xs">类型</span>
        <button v-for="docType in docTypes" :key="docType" :class="filterBtn(invoiceStore.docTypeFilter === docType)" @click="invoiceStore.docTypeFilter = docType">{{ docType }}</button>
      </div>
    </div>

    <div v-if="invoiceStore.invoices.length" class="grid gap-3.5 items-start grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.35fr)] lt-lg:grid-cols-1">
      <aside class="preview-pane min-h-0 max-h-[calc(100vh-250px)] lt-lg:max-h-none overflow-auto p-3 bg-[#f8fafc] border border-line rounded-lg">
        <InvoicePreview />
      </aside>

      <section class="review-pane min-h-0 max-h-[calc(100vh-250px)] lt-lg:max-h-none overflow-auto p-3 bg-[#f8fafc] border border-line rounded-lg">
        <div class="sticky -top-3 z-4 flex items-center justify-between gap-2.5 -mx-3 -mt-3 mb-2.5 px-3 py-3 bg-[#f8fafc]/96 border-b border-line backdrop-blur">
          <div>
            <h2 class="m-0 text-base font-700">识别内容</h2>
            <p class="mt-0.25 text-ink-soft text-xs">{{ sorted.length }} 张发票</p>
          </div>
        </div>
        <div class="flex flex-col gap-2.5">
          <InvoiceRow v-for="item in sorted" :key="item.inv.id" :item="item" />
        </div>
      </section>
    </div>

    <div v-else class="text-center text-ink-soft p-7.5 bg-panel border border-dashed border-line-strong rounded-lg">
      还没有发票。把电子发票 PDF 或扫描件拖到上面。
    </div>
  </div>
</template>

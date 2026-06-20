<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  invoiceStore,
  invoiceActions,
  sortedInvoices,
  buyerOptions,
  docTypeOptions,
  selectInvoice,
  groupPath,
} from "../invoiceStore";
import InvoiceUpload from "../components/InvoiceUpload.vue";
import InvoicePreview from "../components/InvoicePreview.vue";
import { invoiceExportFileName } from "../lib/invoice-export-package";
import { toastInfo, toastWarn } from "../lib/toast";
import { ui } from "../lib/ui";
import { collectFromInvoices } from "../lib/supplier-db";
import { useSupplierStore } from "../stores/supplier";

const router = useRouter();
const viewMode = ref("status");
const supplierStore = useSupplierStore();

// 全局发票搜索（顶栏搜索框 → ui.searchText）：模糊匹配发票号/公司/供应商/项目/文件名，作用于所有列表视图。
// 只在视图层过滤，不进 invoiceStore 逻辑层（保持 selftest 纯净、不影响打印/汇总的 filteredInvoices）。
function matchesSearch(inv) {
  const q = (ui.searchText || "").trim().toLowerCase();
  if (!q) return true;
  return [inv.name, inv.fields.number, inv.fields.code, inv.fields.buyer, inv.fields.seller, inv.fields.project, inv.fields.date]
    .some((v) => String(v || "").toLowerCase().includes(q));
}
const hasSearch = computed(() => !!(ui.searchText || "").trim());
const statusFilter = ref("all"); // 处理状态快捷筛选：all / review(待人工校对) / done(识别完成) / todo(待识别)
function matchesStatus(item) {
  if (statusFilter.value === "review") return item.needsReview;
  if (statusFilter.value === "done") return item.inv.status === "done" && !item.needsReview;
  if (statusFilter.value === "todo") return item.inv.status !== "done";
  return true;
}
const sorted = computed(() => sortedInvoices().filter((x) => matchesSearch(x.inv) && matchesStatusExtended(x)));
const allSorted = computed(() => sortedInvoices({ applyFilters: false }).filter((x) => matchesSearch(x.inv)));
const reviewItems = computed(() => recognizedItems.value);
const recognizedItems = computed(() => allSorted.value.filter((item) => item.inv.status === "done"));
const pendingItems = computed(() => recognizedItems.value.filter((item) => item.inv.accountStatus !== "posted"));
const postedItems = computed(() => recognizedItems.value.filter((item) => item.inv.accountStatus === "posted"));
const unrecognizedCount = computed(() => invoiceStore.invoices.filter((i) => i.status !== "done").length);
const runningCount = computed(() => invoiceStore.invoices.filter((i) => i.status === "running" || i.rendering).length);
const duplicateCount = computed(() => invoiceStore.invoices.filter((i) => i.duplicateReason).length);
const reusedIncludedCount = computed(() => invoiceStore.invoices.filter((i) => i.include && i.history && i.history.usedBefore).length);
const buyers = computed(() => buyerOptions());
const docTypes = computed(() => docTypeOptions());
const statusFilters = computed(() => {
  const list = sortedInvoices({ applyFilters: false });
  return [
    { key: "all", label: "全部", count: list.length },
    { key: "review", label: "待人工校对", count: list.filter((x) => x.needsReview).length },
    { key: "done", label: "识别完成", count: list.filter((x) => x.inv.status === "done" && !x.needsReview).length },
    { key: "todo", label: "待识别", count: list.filter((x) => x.inv.status !== "done").length },
  ];
});

const selectedItem = computed(() => {
  if (!allSorted.value.length) return null;
  return allSorted.value.find((item) => item.inv.id === invoiceStore.selectedId) || allSorted.value[0];
});
const selectedInv = computed(() => selectedItem.value?.inv || null);

const stageTabs = computed(() => [
  { key: "status", label: "文档识别状态", count: invoiceStore.invoices.length },
  { key: "review", label: "发票识别与校对", count: recognizedItems.value.length },
  { key: "pending", label: "待入账", count: pendingItems.value.length },
  { key: "posted", label: "已入账", count: postedItems.value.length },
]);

const viewTitle = computed(() => {
  if (viewMode.value === "review") return "发票识别与校对";
  if (viewMode.value === "pending") return "待入账条目汇总";
  if (viewMode.value === "posted") return "已入账";
  return "文档识别状态";
});

const viewHint = computed(() => {
  if (viewMode.value === "review") return "批次内发票逐张滚动校对，确认后进入待入账。";
  if (viewMode.value === "pending") return "按缩略图、单据编号、开票日期、公司、供应商、类型、金额和项目汇总。";
  if (viewMode.value === "posted") return "查看本批次已经确认入账的发票。";
  return "新增上传后的文档在这里等待识别，批量识别完成后进入校对。";
});

const pendingTotal = computed(() => sumTotal(pendingItems.value));
const postedTotal = computed(() => sumTotal(postedItems.value));

watch(
  () => allSorted.value.map((item) => item.inv.id).join("|"),
  () => {
    if (!allSorted.value.length) {
      viewMode.value = "status";
      return;
    }
    if (!allSorted.value.some((item) => item.inv.id === invoiceStore.selectedId)) {
      selectInvoice(allSorted.value[0].inv.id);
    }
  },
  { immediate: true }
);

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

function setMode(mode) {
  viewMode.value = mode;
  // 进入「发票识别与校对」时若未选中，默认选第一张已识别发票（右侧直接显示校对）
  if (mode === "review" && !selectedInv.value && reviewItems.value[0]) {
    selectInvoice(reviewItems.value[0].inv.id);
  }
}

async function recognizeBatch() {
  if (invoiceStore.busy || !unrecognizedCount.value) return;
  await invoiceActions.recognizeAll();
  viewMode.value = "review";
  toastInfo("批量识别完成，已进入发票识别与校对。", { duration: 2600 });
}

async function recognize(inv) {
  if (!inv || invoiceStore.busy || inv.rendering) return;
  await invoiceActions.recognizeOne(inv);
}

function syncDate(inv) {
  inv.fields.dateText = inv.fields.date;
}

function remove(inv) {
  if (!inv) return;
  invoiceActions.removeInvoice(inv.id);
  if (!invoiceStore.invoices.length) viewMode.value = "status";
}

function editSingle(inv) {
  if (!inv) return;
  selectInvoice(inv.id);
  viewMode.value = "review"; // 统一进「发票识别与校对」并选中该张
}

function syncSellersToSuppliers(invoices) {
  const result = collectFromInvoices(supplierStore.list, invoices);
  if (result.added || result.updated) supplierStore.persist();
  return result;
}

function postInvoice(inv) {
  if (!inv) return;
  if (inv.status !== "done") {
    toastWarn("请先完成识别，再进行入账。");
    return;
  }
  invoiceActions.markAccounted(inv);
  const supplierSync = syncSellersToSuppliers([inv]);
  const supplierText = supplierSync.added || supplierSync.updated
    ? `分供方已同步：新增 ${supplierSync.added} 家${supplierSync.updated ? `，更新 ${supplierSync.updated} 家` : ""}。`
    : "销售方已在分供方库中。";
  toastInfo(`已移动到已入账。${supplierText}`, { duration: 3200 });
}

function postAllPending() {
  const ready = pendingItems.value.filter((item) => item.inv.status === "done");
  if (!ready.length) {
    toastWarn("当前没有可入账的条目。");
    return;
  }
  ready.forEach((item) => invoiceActions.markAccounted(item.inv));
  const supplierSync = syncSellersToSuppliers(ready.map((item) => item.inv));
  const supplierText = supplierSync.added || supplierSync.updated
    ? `同步分供方：新增 ${supplierSync.added} 家${supplierSync.updated ? `，更新 ${supplierSync.updated} 家` : ""}。`
    : "销售方均已在分供方库中。";
  toastInfo(`已批量入账 ${ready.length} 张发票。${supplierText}`, { duration: 3600 });
}

function moveBackToPending(inv) {
  if (!inv) return;
  invoiceActions.markPending(inv);
  toastInfo("已移回待入账。", { duration: 2200 });
}

function statusText(item) {
  const inv = item.inv;
  if (inv.rendering) return "读取中";
  if (inv.status === "running") return "识别中";
  if (inv.status === "error") return "识别失败";
  if (inv.duplicateReason) return "重复已排除";
  if (inv.history?.usedBefore) return "历史已用";
  if (item.needsReview) return "待人工校对";
  if (inv.status === "done") return "识别完成";
  return "待识别";
}

function statusClass(item) {
  const inv = item.inv;
  if (inv.status === "error" || inv.duplicateReason) return "chip-danger";
  if (inv.status === "running" || inv.rendering) return "chip-brand";
  if (inv.history?.usedBefore || item.needsReview) return "chip-warn";
  if (inv.status === "done") return "chip-ok";
  return "chip bg-surface-3 text-ink-soft";
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) && value !== "" ? `¥${n.toFixed(2)}` : "待补";
}

function sumTotal(items) {
  const n = items.reduce((sum, item) => sum + (Number(amountValue(item.inv)) || 0), 0);
  return `¥${n.toFixed(2)}`;
}

function fileMeta(inv) {
  const size = inv.blob?.size ? `${(inv.blob.size / 1024 / 1024).toFixed(1)} MB` : "待读取";
  return `${size} / ${inv.pageCount || 1} 页`;
}

function padSeq(seq) {
  return String(seq).padStart(2, "0");
}

function thumbnail(inv) {
  if (!inv) return "";
  return inv.renderedPages?.[0] || inv.pages?.[0]?.dataUrl || "";
}

function docNo(item) {
  return item.inv.fields.number || item.inv.fields.code || `DOC-${padSeq(item.seq)}`;
}

function docType(inv) {
  return inv.fields.type || inv.fields.docType || "发票";
}

function amountValue(inv) {
  return inv.fields.total || inv.fields.amount || "";
}

function projectText(inv) {
  return inv.fields.project || "未指定项目";
}

function postedTime(inv) {
  if (!inv.accountedAt) return "";
  return new Date(inv.accountedAt).toLocaleString("zh-CN", { hour12: false });
}

const filterBtn = (active) =>
  active
    ? "border border-brand bg-brand-soft text-brand rounded-full px-2.25 py-1 text-xs font-700"
    : "border border-line bg-white text-ink rounded-full px-2.25 py-1 text-xs font-700 hover:border-brand";

const stageBtn = (active) =>
  active
    ? "border border-brand bg-brand text-white rounded-lg px-3 py-2 text-sm font-800 shadow-card"
    : "border border-line bg-white text-ink rounded-lg px-3 py-2 text-sm font-700 hover:border-brand hover:text-brand";

const moreMenuOpen = ref(false);
const reviewListOpen = ref(false);

const statusFiltersExtended = computed(() => {
  const list = sortedInvoices({ applyFilters: false });
  const failCount = list.filter((x) => x.inv.status === "error").length;
  const historyCount = list.filter((x) => x.inv.history?.usedBefore).length;
  return [
    { key: "all", label: "全部", count: list.length },
    { key: "review", label: "待人工校对", count: list.filter((x) => x.needsReview).length },
    { key: "done", label: "识别完成", count: list.filter((x) => x.inv.status === "done" && !x.needsReview).length },
    { key: "todo", label: "待识别", count: list.filter((x) => x.inv.status !== "done").length },
    ...(failCount ? [{ key: "error", label: "识别失败", count: failCount }] : []),
    ...(historyCount ? [{ key: "history", label: "历史已用", count: historyCount }] : []),
  ];
});

function matchesStatusExtended(item) {
  if (statusFilter.value === "review") return item.needsReview;
  if (statusFilter.value === "done") return item.inv.status === "done" && !item.needsReview;
  if (statusFilter.value === "todo") return item.inv.status !== "done";
  if (statusFilter.value === "error") return item.inv.status === "error";
  if (statusFilter.value === "history") return !!item.inv.history?.usedBefore;
  return true;
}
</script>

<template>
  <section v-if="!invoiceStore.invoices.length" class="min-h-[calc(100vh-110px)] grid place-items-center">
    <div class="w-full max-w-4xl flex flex-col items-center gap-8">
      <InvoiceUpload variant="hero" />
      <div class="text-center">
        <div class="mx-auto w-36 h-28 rounded-[28px] bg-gradient-to-b from-white to-[#edf2f7] border border-line shadow-card grid place-items-center text-5xl text-brand/70">票</div>
        <h2 class="mt-5 mb-1 text-xl font-800">尚未上传任何文档</h2>
        <p class="m-0 text-ink-soft">上传后进入文档识别状态。</p>
      </div>
    </div>
  </section>

  <div v-else class="flex flex-col gap-4">
    <!-- sticky 阶段 tab 行 -->
    <div class="sticky top-16 z-10 bg-bg -mx-4 px-4 pt-1 pb-2 lt-md:-mx-3 lt-md:px-3">
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto">
          <button
            v-for="tab in stageTabs"
            :key="tab.key"
            type="button"
            :class="stageBtn(viewMode === tab.key)"
            @click="setMode(tab.key)"
          >
            {{ tab.label }}
            <span v-if="tab.count" class="ml-1 inline-flex items-center justify-center min-w-5 h-5 rounded-full text-[11px] font-700" :class="viewMode === tab.key ? 'bg-white/25 text-white' : 'bg-surface-3 text-ink-soft'">{{ tab.count }}</span>
          </button>
        </div>
        <div class="flex items-center gap-2 flex-none">
          <button class="btn-primary px-4 py-2" type="button" :disabled="invoiceStore.busy || !unrecognizedCount" @click="recognizeBatch">
            <span class="i-lucide-scan-text w-4 h-4 flex-none"></span>
            {{ invoiceStore.busy ? "识别中" : "批量识别" }}
          </button>
          <div class="relative">
            <button class="btn px-2 py-2" type="button" title="更多操作" @click="moreMenuOpen = !moreMenuOpen">
              <span class="i-lucide-ellipsis w-4 h-4"></span>
            </button>
            <div v-if="moreMenuOpen" class="absolute right-0 top-full mt-1 min-w-36 bg-white border border-line-strong rounded-lg shadow-pop p-1 z-20" @click="moreMenuOpen = false">
              <button class="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-md text-left hover:bg-brand-soft hover:text-brand" type="button" @click="invoiceActions.clearAll">
                <span class="i-lucide-trash-2 w-4 h-4 text-danger"></span>
                清空列表
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <section v-if="viewMode === 'status'" class="flex flex-col gap-4">
      <section class="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div class="panel p-4">
          <div class="text-xs text-ink-soft font-700">全部</div>
          <div class="mt-1 text-2xl font-800">{{ invoiceStore.invoices.length }}</div>
        </div>
        <div class="panel p-4">
          <div class="text-xs text-ink-soft font-700">待识别</div>
          <div class="mt-1 text-2xl font-800" :class="unrecognizedCount ? 'text-warn-ink' : ''">{{ unrecognizedCount }}</div>
        </div>
        <button type="button" class="panel p-4 text-left transition active:scale-[.98] hover:(border-brand shadow-pop)" @click="setMode('pending')">
          <div class="text-xs text-ink-soft font-700">待入账</div>
          <div class="mt-1 text-2xl font-800 text-ok">{{ pendingItems.length }}</div>
        </button>
        <button type="button" class="panel p-4 text-left transition active:scale-[.98] hover:(border-brand shadow-pop)" @click="setMode('posted')">
          <div class="text-xs text-ink-soft font-700">已入账</div>
          <div class="mt-1 text-2xl font-800 text-ok">{{ postedItems.length }}</div>
        </button>
      </section>

      <InvoiceUpload />

      <section class="panel overflow-hidden">
        <div class="p-4 border-b border-line bg-surface-2 flex flex-col items-start gap-3">
          <div class="flex items-center gap-3 flex-wrap w-full">
            <label class="relative flex-none">
              <span class="absolute left-2.5 top-1/2 -translate-y-1/2 i-lucide-search w-3.5 h-3.5 text-ink-faint"></span>
              <input
                v-model="ui.searchText"
                class="field-input pl-8 pr-3 py-1.5 w-52 rounded-full bg-white"
                type="search"
                placeholder="搜索文件名、公司…"
              />
            </label>
            <span v-if="hasSearch" class="chip-brand">匹配 {{ sorted.length }} 条</span>
          </div>
          <div class="flex flex-col gap-2 items-start min-w-0 w-full">
            <div class="flex items-center gap-2 flex-wrap justify-start">
              <span class="text-xs text-ink-soft font-700 flex-none w-16 text-left">处理状态</span>
              <button v-for="s in statusFiltersExtended" :key="s.key" type="button" :class="filterBtn(statusFilter === s.key)" @click="statusFilter = s.key">{{ s.label }}<span class="ml-1 opacity-70">{{ s.count }}</span></button>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-start">
              <span class="text-xs text-ink-soft font-700 flex-none w-16 text-left">购买方</span>
              <button v-for="buyer in buyers" :key="buyer" type="button" :class="filterBtn(invoiceStore.buyerFilter === buyer)" @click="invoiceStore.buyerFilter = buyer">{{ buyer }}</button>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-start">
              <span class="text-xs text-ink-soft font-700 flex-none w-16 text-left">票据类型</span>
              <button v-for="docTypeOption in docTypes" :key="docTypeOption" type="button" :class="filterBtn(invoiceStore.docTypeFilter === docTypeOption)" @click="invoiceStore.docTypeFilter = docTypeOption">{{ docTypeOption }}</button>
            </div>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[920px] text-left border-collapse">
            <thead class="bg-surface-2 text-ink-soft text-xs font-800 tracking-wide">
              <tr class="border-b border-line">
                <th class="px-4 py-3">#</th>
                <th class="px-4 py-3">文件名</th>
                <th class="px-4 py-3">类型</th>
                <th class="px-4 py-3">序号</th>
                <th class="px-4 py-3">大小/页数</th>
                <th class="px-4 py-3">状态</th>
                <th class="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr
                v-for="(item, index) in sorted"
                :key="item.inv.id"
                :data-inv="item.inv.id"
                class="hover:bg-surface-2 transition cursor-pointer"
                :class="invoiceStore.selectedId === item.inv.id ? 'bg-brand-soft/55' : ''"
                @click="editSingle(item.inv)"
              >
                <td class="px-4 py-3 text-ink-soft">{{ index + 1 }}</td>
                <td class="px-4 py-3">
                  <div class="min-w-0">
                    <div class="font-700 truncate max-w-74" :title="item.inv.name">{{ item.inv.name }}</div>
                    <div class="text-xs text-ink-soft truncate max-w-74" :title="invoiceExportFileName(item.inv)">{{ invoiceExportFileName(item.inv) }}</div>
                  </div>
                </td>
                <td class="px-4 py-3 text-ink-soft">{{ docType(item.inv) }}</td>
                <td class="px-4 py-3 font-mono text-ink-soft">{{ padSeq(item.seq) }}</td>
                <td class="px-4 py-3 text-ink-soft">{{ fileMeta(item.inv) }}</td>
                <td class="px-4 py-3"><span :class="statusClass(item)">{{ statusText(item) }}</span></td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition" type="button" title="查看校对" @click.stop="editSingle(item.inv)">
                    <span class="i-lucide-file-search w-4 h-4"></span>
                  </button>
                  <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-danger hover:(border-danger bg-danger/5) transition ml-1.5" type="button" title="删除" @click.stop="remove(item.inv)">
                    <span class="i-lucide-trash-2 w-4 h-4"></span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-4 border-t border-line bg-surface-2 flex justify-between items-center gap-3 flex-wrap text-xs text-ink-soft">
          <span>显示 {{ sorted.length }} 个文档，共 {{ invoiceStore.invoices.length }} 个</span>
          <span v-if="duplicateCount || reusedIncludedCount">
            <span v-if="duplicateCount" class="chip-danger mr-1.5">{{ duplicateCount }} 张重复</span>
            <span v-if="reusedIncludedCount" class="chip-warn">{{ reusedIncludedCount }} 张历史已用</span>
          </span>
        </div>
      </section>
    </section>

    <section v-else-if="viewMode === 'review'" class="grid grid-cols-[300px_minmax(360px,1fr)_minmax(380px,0.95fr)] gap-4 h-[calc(100vh-190px)] min-h-0 overflow-hidden lt-lg:grid-cols-[minmax(360px,1fr)_minmax(380px,0.95fr)] lt-md:grid-cols-1 lt-md:h-auto lt-md:overflow-visible">
      <!-- 左：发票列表（桌面三栏；中屏收为浮层按钮唤出；手机堆叠） -->
      <aside class="panel overflow-hidden flex flex-col min-h-0 lt-lg:fixed lt-lg:inset-y-0 lt-lg:left-0 lt-lg:z-40 lt-lg:w-72 lt-lg:shadow-pop lt-lg:transition-transform" :class="reviewListOpen ? 'lt-lg:translate-x-0' : 'lt-lg:-translate-x-full'" @click.self="reviewListOpen = false">
        <div class="px-3 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between gap-2">
          <span class="text-xs text-ink-soft font-700">本批次 {{ recognizedItems.length }} 张 · <b class="text-brand">待入账 {{ pendingItems.length }}</b></span>
          <button class="hidden lt-lg:inline-flex items-center justify-center w-6 h-6 rounded-btn border border-line bg-white text-ink-soft hover:text-brand" type="button" @click="reviewListOpen = false">
            <span class="i-lucide-x w-3.5 h-3.5"></span>
          </button>
        </div>
        <div v-if="!reviewItems.length" class="p-8 text-center text-ink-soft text-sm">暂无可校对的发票。</div>
        <div v-else class="overflow-y-auto flex flex-col">
          <button
            v-for="item in reviewItems"
            :key="item.inv.id"
            type="button"
            :data-inv="item.inv.id"
            class="flex items-center gap-2.5 px-3 py-2.5 border-b border-line text-left transition hover:bg-surface-2"
            :class="invoiceStore.selectedId === item.inv.id ? 'bg-brand-soft/60' : ''"
            @click="selectInvoice(item.inv.id); reviewListOpen = false"
          >
            <span class="w-7 h-9 rounded border border-line bg-surface-3 overflow-hidden grid place-items-center flex-none">
              <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="w-full h-full object-cover" alt="" />
              <span v-else class="text-brand text-xs font-800">票</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-700 truncate">{{ docNo(item) }}</span>
              <span class="block text-xs text-ink-soft truncate">{{ item.inv.fields.buyer || item.inv.name }}</span>
            </span>
            <span :class="statusClass(item)" class="flex-none">{{ statusText(item) }}</span>
          </button>
        </div>
      </aside>

      <!-- 中屏浮层遮罩 -->
      <div v-if="reviewListOpen" class="hidden lt-lg:block fixed inset-0 z-39 bg-black/30" @click="reviewListOpen = false"></div>

      <!-- 中：打印排版预览 -->
      <aside class="panel overflow-hidden flex flex-col min-h-0 bg-surface-sink relative">
        <button class="hidden lt-lg:flex absolute top-2 left-2 z-5 items-center gap-1 btn px-2 py-1 text-xs" type="button" @click="reviewListOpen = !reviewListOpen">
          <span class="i-lucide-list w-3.5 h-3.5"></span>
          列表
        </button>
        <div class="flex-1 min-h-0 overflow-y-auto p-3">
          <InvoicePreview />
        </div>
      </aside>

      <!-- 右：当前选中发票校对 -->
      <div v-if="!selectedInv" class="panel grid place-items-center text-ink-soft min-h-92">在左侧或打印预览中选择一张发票开始校对。</div>
      <section v-else class="panel p-4 flex flex-col gap-4 min-h-0 overflow-y-auto">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <h2 class="m-0 text-base font-800">识别结果提取</h2>
            <div class="flex items-center gap-2">
              <span :class="statusClass(selectedItem)">{{ statusText(selectedItem) }}</span>
              <span v-if="selectedInv.accountStatus === 'posted'" class="chip-ok">已入账</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3.5 max-md:grid-cols-1" @change="invoiceActions.refreshDuplicates">
            <label class="field-label">单据编号<input class="field-input font-mono" v-model="selectedInv.fields.number" /></label>
            <label class="field-label">开票日期<input class="field-input font-mono" v-model="selectedInv.fields.date" placeholder="2026-03-09" @input="syncDate(selectedInv)" /></label>
            <label class="field-label">购买方<input class="field-input" v-model="selectedInv.fields.buyer" placeholder="购买方公司名称" /></label>
            <label class="field-label">供应商<input class="field-input" v-model="selectedInv.fields.seller" placeholder="供应商名称" /></label>
            <label class="field-label">票据类型<input class="field-input" v-model="selectedInv.fields.type" placeholder="如 增值税普通发票" /></label>
            <label class="field-label">金额<input class="field-input font-mono" v-model="selectedInv.fields.total" inputmode="decimal" /></label>
            <label class="field-label col-span-2 max-md:col-span-1">对应项目<input class="field-input" v-model="selectedInv.fields.project" placeholder="项目名称" /></label>
            <label class="field-label">税额<input class="field-input font-mono" v-model="selectedInv.fields.tax" inputmode="decimal" /></label>
            <label class="field-label">税点<input class="field-input font-mono" v-model="selectedInv.fields.rate" placeholder="如 13%" /></label>
            <label class="field-label col-span-full">票面备注<input class="field-input" v-model="selectedInv.fields.remark" placeholder="发票备注栏内容" /></label>
          </div>
          <div v-if="groupPath(selectedInv).length" class="text-xs text-ink-soft">分目录：{{ groupPath(selectedInv).join(" / ") }}</div>
          <div class="mt-auto pt-3 border-t border-line flex justify-between items-center gap-3 flex-wrap">
            <button class="btn-danger px-3 py-1.75" type="button" @click="remove(selectedInv)">废弃该单据</button>
            <div class="flex gap-2 flex-wrap">
              <button class="btn px-3 py-1.75" type="button" :disabled="selectedInv.rendering || invoiceStore.busy" @click="recognize(selectedInv)">重新识别</button>
              <button v-if="selectedInv.accountStatus === 'posted'" class="btn px-4 py-1.75" type="button" @click="moveBackToPending(selectedInv)">移回待入账</button>
              <button v-else class="btn-primary px-4 py-1.75" type="button" :disabled="selectedInv.status !== 'done'" @click="postInvoice(selectedInv)">确认并入账</button>
            </div>
          </div>
      </section>
    </section>


    <section v-else-if="viewMode === 'pending'" class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="text-ink-soft">合计 <span class="text-ink text-lg font-800 font-mono">{{ pendingTotal }}</span></div>
        <button class="btn-primary px-4 py-2" type="button" :disabled="!pendingItems.length" @click="postAllPending">
          <span class="i-lucide-file-check w-4 h-4 flex-none"></span>
          批量入账
        </button>
      </div>

      <div class="panel overflow-hidden">
        <div v-if="!pendingItems.length" class="p-8 text-center text-ink-soft">暂无待入账条目。</div>
        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[1180px] text-left border-collapse">
            <thead class="bg-surface-2 text-ink-soft text-xs font-800 tracking-wide">
              <tr class="border-b border-line">
                <th class="px-4 py-3">缩略</th>
                <th class="px-4 py-3">单据编号</th>
                <th class="px-4 py-3">开票日期</th>
                <th class="px-4 py-3">购买方</th>
                <th class="px-4 py-3">供应商</th>
                <th class="px-4 py-3">类型</th>
                <th class="px-4 py-3 text-right">金额</th>
                <th class="px-4 py-3">对应项目</th>
                <th class="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr v-for="item in pendingItems" :key="item.inv.id" :data-inv="item.inv.id" class="hover:bg-surface-2">
                <td class="px-4 py-3">
                  <div class="w-10 h-13 rounded border border-line bg-surface-3 overflow-hidden grid place-items-center">
                    <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="w-full h-full object-cover" alt="" />
                    <span v-else class="text-brand font-800 text-xs">票</span>
                  </div>
                </td>
                <td class="px-4 py-3 font-mono font-700">{{ docNo(item) }}</td>
                <td class="px-4 py-3 font-mono text-ink-soft">{{ item.inv.fields.date || "待补" }}</td>
                <td class="px-4 py-3 max-w-48 truncate" :title="item.inv.fields.buyer">{{ item.inv.fields.buyer || "待补" }}</td>
                <td class="px-4 py-3 max-w-56 truncate" :title="item.inv.fields.seller">{{ item.inv.fields.seller || "待补" }}</td>
                <td class="px-4 py-3">{{ docType(item.inv) }}</td>
                <td class="px-4 py-3 text-right font-mono font-800">{{ money(amountValue(item.inv)) }}</td>
                <td class="px-4 py-3 max-w-48 truncate text-ink-soft" :title="projectText(item.inv)">{{ projectText(item.inv) }}</td>
                <td class="px-4 py-3 text-right whitespace-nowrap">
                  <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition" type="button" title="编辑" @click="router.push(`/invoice/${item.inv.id}`)">
                    <span class="i-lucide-square-pen w-4 h-4"></span>
                  </button>
                  <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition ml-1.5" type="button" title="入账" @click="postInvoice(item.inv)">
                    <span class="i-lucide-file-check w-4 h-4"></span>
                  </button>
                  <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-danger hover:(border-danger bg-danger/5) transition ml-1.5" type="button" title="删除" @click="remove(item.inv)">
                    <span class="i-lucide-trash-2 w-4 h-4"></span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section v-else-if="viewMode === 'posted'" class="panel overflow-hidden">
      <div v-if="!postedItems.length" class="p-8 text-center text-ink-soft">暂无已入账条目。</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[1260px] text-left border-collapse">
          <thead class="bg-surface-2 text-ink-soft text-xs font-800 tracking-wide">
            <tr class="border-b border-line">
              <th class="px-4 py-3">缩略</th>
              <th class="px-4 py-3">单据编号</th>
              <th class="px-4 py-3">开票日期</th>
              <th class="px-4 py-3">购买方</th>
              <th class="px-4 py-3">供应商</th>
              <th class="px-4 py-3">类型</th>
              <th class="px-4 py-3 text-right">金额</th>
              <th class="px-4 py-3">对应项目</th>
              <th class="px-4 py-3">入账时间</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="item in postedItems" :key="item.inv.id" :data-inv="item.inv.id" class="hover:bg-surface-2">
              <td class="px-4 py-3">
                <div class="w-10 h-13 rounded border border-line bg-surface-3 overflow-hidden grid place-items-center">
                  <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-brand font-800 text-xs">票</span>
                </div>
              </td>
              <td class="px-4 py-3 font-mono font-700">{{ docNo(item) }}</td>
              <td class="px-4 py-3 font-mono text-ink-soft">{{ item.inv.fields.date || "待补" }}</td>
              <td class="px-4 py-3 max-w-48 truncate" :title="item.inv.fields.buyer">{{ item.inv.fields.buyer || "待补" }}</td>
              <td class="px-4 py-3 max-w-56 truncate" :title="item.inv.fields.seller">{{ item.inv.fields.seller || "待补" }}</td>
              <td class="px-4 py-3">{{ docType(item.inv) }}</td>
              <td class="px-4 py-3 text-right font-mono font-800">{{ money(amountValue(item.inv)) }}</td>
              <td class="px-4 py-3 max-w-48 truncate text-ink-soft" :title="projectText(item.inv)">{{ projectText(item.inv) }}</td>
              <td class="px-4 py-3 text-ink-soft font-mono text-sm">{{ postedTime(item.inv) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition" type="button" title="编辑" @click="router.push(`/invoice/${item.inv.id}`)">
                  <span class="i-lucide-square-pen w-4 h-4"></span>
                </button>
                <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition ml-1.5" type="button" title="移回待入账" @click="moveBackToPending(item.inv)">
                  <span class="i-lucide-file-output w-4 h-4"></span>
                </button>
                <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-danger hover:(border-danger bg-danger/5) transition ml-1.5" type="button" title="删除" @click="remove(item.inv)">
                  <span class="i-lucide-trash-2 w-4 h-4"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

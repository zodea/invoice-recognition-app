<script setup>
import { computed, nextTick, ref, watch } from "vue";
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
import { invoiceExportFileName } from "../lib/invoice-export-package";
import { toastInfo, toastWarn } from "../lib/toast";
import { ui } from "../lib/ui";

const viewMode = ref("status");

// 全局发票搜索（顶栏搜索框 → ui.searchText）：模糊匹配发票号/公司/供应商/项目/文件名，作用于所有列表视图。
// 只在视图层过滤，不进 invoiceStore 逻辑层（保持 selftest 纯净、不影响打印/汇总的 filteredInvoices）。
function matchesSearch(inv) {
  const q = (ui.searchText || "").trim().toLowerCase();
  if (!q) return true;
  return [inv.name, inv.fields.number, inv.fields.code, inv.fields.buyer, inv.fields.seller, inv.fields.project, inv.fields.date]
    .some((v) => String(v || "").toLowerCase().includes(q));
}
const sorted = computed(() => sortedInvoices().filter((x) => matchesSearch(x.inv)));
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

const selectedItem = computed(() => {
  if (!allSorted.value.length) return null;
  return allSorted.value.find((item) => item.inv.id === invoiceStore.selectedId) || allSorted.value[0];
});
const selectedInv = computed(() => selectedItem.value?.inv || null);
const selectedPreview = computed(() => thumbnail(selectedInv.value));
// 单张校对：多页预览导航 + 缩放（对齐设计图 _1/_4：左页缩略图列 + 主预览 + 缩放/旋转）
const previewPage = ref(0);
const previewZoom = ref(1);
const previewPages = computed(() => {
  const inv = selectedInv.value;
  if (inv?.renderedPages?.length) return inv.renderedPages;
  return selectedPreview.value ? [selectedPreview.value] : [];
});
const previewSrc = computed(() => previewPages.value[previewPage.value] || previewPages.value[0] || "");
function zoomBy(delta) {
  previewZoom.value = Math.min(3, Math.max(0.5, Math.round((previewZoom.value + delta) * 100) / 100));
}
// 切换选中发票或进入单张视图时，预览回到第一页、还原缩放
watch([() => invoiceStore.selectedId, viewMode], () => {
  previewPage.value = 0;
  previewZoom.value = 1;
});
const statusCards = computed(() => allSorted.value.slice(0, 3));

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
  if (viewMode.value === "single") return "单张识别与校对";
  return "文档识别状态";
});

const viewHint = computed(() => {
  if (viewMode.value === "review") return "批次内发票逐张滚动校对，确认后进入待入账。";
  if (viewMode.value === "pending") return "按缩略图、单据编号、开票日期、公司、供应商、类型、金额和项目汇总。";
  if (viewMode.value === "posted") return "查看本批次已经确认入账的发票。";
  if (viewMode.value === "single") return "从待入账条目进入的单张校对视图。";
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
  if (mode === "single" && !selectedInv.value && allSorted.value[0]) {
    selectInvoice(allSorted.value[0].inv.id);
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

function rotateSelected(dir = 1) {
  if (!selectedInv.value || invoiceStore.busy) return;
  invoiceActions.rotateInvoice(selectedInv.value, dir);
}

function remove(inv) {
  if (!inv) return;
  invoiceActions.removeInvoice(inv.id);
  if (!invoiceStore.invoices.length) viewMode.value = "status";
}

function editSingle(inv) {
  if (!inv) return;
  selectInvoice(inv.id);
  viewMode.value = "single";
}

function postInvoice(inv) {
  if (!inv) return;
  if (inv.status !== "done") {
    toastWarn("请先完成识别，再进行入账。");
    return;
  }
  invoiceActions.markAccounted(inv);
  toastInfo("已移动到已入账。", { duration: 2200 });
}

function postAllPending() {
  const ready = pendingItems.value.filter((item) => item.inv.status === "done");
  if (!ready.length) {
    toastWarn("当前没有可入账的条目。");
    return;
  }
  ready.forEach((item) => invoiceActions.markAccounted(item.inv));
  toastInfo(`已批量入账 ${ready.length} 张发票。`, { duration: 2600 });
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
  return "chip bg-[#f3f4f6] text-ink-soft";
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

  <div v-else class="flex flex-col gap-5">
    <section class="panel p-4 flex justify-between items-start gap-4 flex-wrap">
      <div class="min-w-0">
        <nav class="flex items-center gap-1.5 text-xs text-ink-soft mb-2">
          <span>发票识别</span>
          <span>/</span>
          <span class="text-brand font-800">{{ viewTitle }}</span>
        </nav>
        <h1 class="m-0 text-[30px] leading-tight font-800">{{ viewTitle }}</h1>
        <p class="mt-2 mb-0 text-ink-soft">{{ viewHint }}</p>
      </div>
      <div class="flex flex-col items-end gap-3 max-md:items-start">
        <div class="flex gap-2 flex-wrap justify-end max-md:justify-start">
          <button
            v-for="tab in stageTabs"
            :key="tab.key"
            type="button"
            :class="stageBtn(viewMode === tab.key)"
            @click="setMode(tab.key)"
          >
            {{ tab.label }}
            <span class="ml-1 opacity-75">{{ tab.count }}</span>
          </button>
        </div>
        <div class="flex gap-2 flex-wrap justify-end max-md:justify-start">
          <button v-if="viewMode === 'status'" class="btn px-4 py-2" type="button" @click="setMode('pending')">待入账</button>
          <button v-if="viewMode === 'status'" class="btn px-4 py-2" type="button" @click="setMode('posted')">已入账</button>
          <button class="btn px-4 py-2" type="button" @click="invoiceActions.clearAll">清空列表</button>
          <button class="btn-primary px-5 py-2" type="button" :disabled="invoiceStore.busy || !unrecognizedCount" @click="recognizeBatch">
            {{ invoiceStore.busy ? "识别中" : "批量识别" }}
          </button>
        </div>
      </div>
    </section>

    <section v-if="viewMode === 'status'" class="flex flex-col gap-4">
      <section class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <article
          v-for="item in statusCards"
          :key="item.inv.id"
          class="panel p-3.5 cursor-pointer transition hover:shadow-pop"
          :class="invoiceStore.selectedId === item.inv.id ? 'ring-2 ring-brand/25 border-brand' : ''"
          :data-inv="item.inv.id"
          @click="selectInvoice(item.inv.id)"
        >
          <div class="flex gap-3">
            <div class="w-16 h-20 rounded-lg border border-line bg-[#f3f4f6] overflow-hidden grid place-items-center flex-none">
              <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="w-full h-full object-cover opacity-75" alt="" />
              <span v-else class="text-2xl text-brand">票</span>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="m-0 text-base font-800 truncate" :title="item.inv.name">{{ item.inv.name }}</h3>
              <p class="mt-1 mb-4 text-xs text-ink-soft">{{ fileMeta(item.inv) }}</p>
              <span :class="statusClass(item)">{{ statusText(item) }}</span>
            </div>
          </div>
        </article>

        <InvoiceUpload class="min-h-34" />
      </section>

      <section class="panel overflow-hidden">
        <div class="p-4 border-b border-line bg-[#f8fafc] flex justify-between items-center gap-3 flex-wrap">
          <div>
            <h2 class="m-0 text-lg font-800">所有已上传文档</h2>
            <p class="mt-1 text-xs text-ink-soft">{{ sorted.length }} 个文档，{{ unrecognizedCount }} 个待识别，{{ runningCount }} 个读取/识别中</p>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button v-for="buyer in buyers" :key="buyer" type="button" :class="filterBtn(invoiceStore.buyerFilter === buyer)" @click="invoiceStore.buyerFilter = buyer">{{ buyer }}</button>
            <button v-for="docTypeOption in docTypes" :key="docTypeOption" type="button" :class="filterBtn(invoiceStore.docTypeFilter === docTypeOption)" @click="invoiceStore.docTypeFilter = docTypeOption">{{ docTypeOption }}</button>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full min-w-[920px] text-left border-collapse">
            <thead class="bg-[#f8fafc] text-ink-soft text-xs font-800 tracking-wide">
              <tr class="border-b border-line">
                <th class="px-5 py-3">文件名</th>
                <th class="px-5 py-3">类型</th>
                <th class="px-5 py-3">序号</th>
                <th class="px-5 py-3">上传信息</th>
                <th class="px-5 py-3">处理状态</th>
                <th class="px-5 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-line">
              <tr
                v-for="item in sorted"
                :key="item.inv.id"
                :data-inv="item.inv.id"
                class="hover:bg-[#f8fafc] transition cursor-pointer"
                :class="invoiceStore.selectedId === item.inv.id ? 'bg-brand-soft/55' : ''"
                @click="selectInvoice(item.inv.id)"
              >
                <td class="px-5 py-3">
                  <div class="flex items-center gap-3">
                    <span class="grid place-items-center w-8 h-8 rounded-lg bg-brand-soft text-brand font-800">票</span>
                    <div class="min-w-0">
                      <div class="font-700 truncate max-w-74" :title="item.inv.name">{{ item.inv.name }}</div>
                      <div class="text-xs text-ink-soft truncate max-w-74" :title="invoiceExportFileName(item.inv)">{{ invoiceExportFileName(item.inv) }}</div>
                    </div>
                  </div>
                </td>
                <td class="px-5 py-3 text-ink-soft">{{ docType(item.inv) }}</td>
                <td class="px-5 py-3 font-mono text-ink-soft">{{ padSeq(item.seq) }}</td>
                <td class="px-5 py-3 text-ink-soft">{{ fileMeta(item.inv) }}</td>
                <td class="px-5 py-3"><span :class="statusClass(item)">{{ statusText(item) }}</span></td>
                <td class="px-5 py-3 text-right">
                  <button class="btn px-2.5 py-1.5 text-xs" type="button" :disabled="item.inv.rendering || invoiceStore.busy" @click.stop="recognize(item.inv)">识别</button>
                  <button class="btn-danger px-2.5 py-1.5 text-xs ml-1.5" type="button" @click.stop="remove(item.inv)">删除</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="p-4 border-t border-line bg-[#f8fafc] flex justify-between items-center gap-3 flex-wrap text-xs text-ink-soft">
          <span>显示 {{ sorted.length }} 个文档，共 {{ invoiceStore.invoices.length }} 个</span>
          <span v-if="duplicateCount || reusedIncludedCount">
            <span v-if="duplicateCount" class="chip-danger mr-1.5">{{ duplicateCount }} 张重复</span>
            <span v-if="reusedIncludedCount" class="chip-warn">{{ reusedIncludedCount }} 张历史已用</span>
          </span>
        </div>
      </section>
    </section>

    <section v-else-if="viewMode === 'review'" class="flex flex-col gap-4">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="panel p-4">
          <div class="text-xs text-ink-soft font-700">本批次</div>
          <div class="mt-1 text-2xl font-800">{{ invoiceStore.invoices.length }} 张</div>
        </div>
        <div class="panel p-4">
          <div class="text-xs text-ink-soft font-700">待入账</div>
          <div class="mt-1 text-2xl font-800">{{ pendingItems.length }} 张 / {{ pendingTotal }}</div>
        </div>
        <div class="panel p-4">
          <div class="text-xs text-ink-soft font-700">已入账</div>
          <div class="mt-1 text-2xl font-800">{{ postedItems.length }} 张 / {{ postedTotal }}</div>
        </div>
      </div>

      <div v-if="!reviewItems.length" class="panel p-8 text-center text-ink-soft">暂无可校对的发票。</div>

      <div v-else class="max-h-[calc(100vh-250px)] overflow-y-auto flex flex-col gap-4 pr-1">
        <article
          v-for="item in reviewItems"
          :key="item.inv.id"
          class="panel overflow-hidden"
          :data-inv="item.inv.id"
        >
          <div class="px-4 py-3 border-b border-line bg-[#f8fafc] flex justify-between items-center gap-3 flex-wrap">
            <div class="min-w-0">
              <h2 class="m-0 text-base font-800 truncate" :title="item.inv.name">{{ docNo(item) }}</h2>
              <p class="mt-1 mb-0 text-xs text-ink-soft truncate" :title="item.inv.name">{{ item.inv.name }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span v-if="(item.inv.pageCount || 1) > 1" class="chip bg-[#f3f4f6] text-ink-soft">{{ item.inv.pageCount }} 页</span>
              <span :class="statusClass(item)">{{ statusText(item) }}</span>
              <span v-if="item.inv.accountStatus === 'posted'" class="chip-ok">已入账</span>
            </div>
          </div>

          <div class="grid grid-cols-[minmax(280px,4.2fr)_minmax(420px,5.8fr)] lt-xl:grid-cols-1">
            <aside class="border-r border-line bg-[#eef1f5] min-h-92 p-4 lt-xl:border-r-0 lt-xl:border-b">
              <div class="h-full min-h-80 rounded-lg border border-line bg-white/70 overflow-auto p-3 grid place-items-center">
                <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="max-w-full bg-white shadow-card" alt="" />
                <div v-else class="text-center text-ink-soft">
                  <div class="text-4xl text-brand/60 mb-2">票</div>
                  <div>{{ item.inv.name }}</div>
                </div>
              </div>
            </aside>

            <section class="p-4 flex flex-col gap-4">
              <div class="grid grid-cols-2 gap-3.5 max-md:grid-cols-1" @change="invoiceActions.refreshDuplicates">
                <label class="field-label">单据编号<input class="field-input font-mono" v-model="item.inv.fields.number" /></label>
                <label class="field-label">开票日期<input class="field-input font-mono" v-model="item.inv.fields.date" placeholder="2026-03-09" @input="syncDate(item.inv)" /></label>
                <label class="field-label">公司<input class="field-input" v-model="item.inv.fields.buyer" placeholder="公司名称" /></label>
                <label class="field-label">供应商<input class="field-input" v-model="item.inv.fields.seller" placeholder="供应商名称" /></label>
                <label class="field-label">类型<input class="field-input" v-model="item.inv.fields.type" placeholder="发票类型" /></label>
                <label class="field-label">金额<input class="field-input font-mono" v-model="item.inv.fields.total" inputmode="decimal" /></label>
                <label class="field-label col-span-2 max-md:col-span-1">对应项目<input class="field-input" v-model="item.inv.fields.project" placeholder="项目名称" /></label>
                <label class="field-label">税额<input class="field-input font-mono" v-model="item.inv.fields.tax" inputmode="decimal" /></label>
                <label class="field-label">税点<input class="field-input font-mono" v-model="item.inv.fields.rate" placeholder="如 13%" /></label>
                <label class="field-label col-span-full">票面备注<input class="field-input" v-model="item.inv.fields.remark" placeholder="发票备注栏内容" /></label>
              </div>

              <div v-if="groupPath(item.inv).length" class="text-xs text-ink-soft">
                分目录：{{ groupPath(item.inv).join(" / ") }}
              </div>

              <div class="mt-auto pt-3 border-t border-line flex justify-between items-center gap-3 flex-wrap">
                <button class="btn-danger px-3 py-1.75" type="button" @click="remove(item.inv)">删除</button>
                <div class="flex gap-2 flex-wrap">
                  <button class="btn px-3 py-1.75" type="button" @click="editSingle(item.inv)">单独编辑</button>
                  <button class="btn-primary px-4 py-1.75" type="button" :disabled="item.inv.status !== 'done'" @click="postInvoice(item.inv)">入账</button>
                </div>
              </div>
            </section>
          </div>
        </article>
      </div>
    </section>

    <section v-else-if="viewMode === 'single' && selectedInv" class="grid grid-cols-[minmax(320px,4.2fr)_minmax(520px,5.8fr)] gap-4 lt-xl:grid-cols-1">
      <aside class="panel overflow-hidden flex flex-col">
        <div class="px-4 py-3 border-b border-line bg-[#f8fafc] flex items-center justify-between gap-3 flex-wrap">
          <div class="min-w-0">
            <h2 class="m-0 text-base font-800 truncate" :title="selectedInv.name">{{ selectedInv.name }}</h2>
            <p class="mt-1 mb-0 text-xs text-ink-soft">{{ fileMeta(selectedInv) }}<span v-if="previewPages.length > 1"> · 第 {{ previewPage + 1 }} / {{ previewPages.length }} 页</span></p>
          </div>
          <div class="flex gap-1.5 flex-none">
            <button class="btn px-2 py-1.5 text-xs" type="button" title="缩小" :disabled="previewZoom <= 0.5" @click="zoomBy(-0.25)">－</button>
            <button class="btn px-2 py-1.5 text-xs" type="button" title="放大" :disabled="previewZoom >= 3" @click="zoomBy(0.25)">＋</button>
            <button class="btn px-2.5 py-1.5 text-xs" type="button" @click="rotateSelected(-1)">左旋</button>
            <button class="btn px-2.5 py-1.5 text-xs" type="button" @click="rotateSelected(1)">右旋</button>
          </div>
        </div>
        <div class="flex flex-1 min-h-[calc(100vh-270px)]">
          <div v-if="previewPages.length > 1" class="w-22 flex-none border-r border-line bg-[#f8fafc] overflow-y-auto p-2 flex flex-col gap-2">
            <button
              v-for="(src, idx) in previewPages"
              :key="idx"
              type="button"
              class="block rounded-lg border overflow-hidden bg-white transition active:scale-[.97]"
              :class="idx === previewPage ? 'border-brand ring-2 ring-brand/25' : 'border-line hover:border-brand'"
              @click="previewPage = idx"
            >
              <img :src="src" class="w-full block" alt="" />
              <span class="block text-[11px] text-center py-0.5" :class="idx === previewPage ? 'text-brand font-800' : 'text-ink-soft'">第 {{ idx + 1 }} 页</span>
            </button>
          </div>
          <div class="flex-1 bg-[#eef1f5] overflow-auto p-4 grid place-items-center">
            <img v-if="previewSrc" :src="previewSrc" class="max-w-full bg-white shadow-card origin-top transition-transform" :style="{ transform: `scale(${previewZoom})` }" alt="" />
            <div v-else class="text-center text-ink-soft">
              <div class="text-4xl text-brand/60 mb-2">票</div>
              <div>{{ selectedInv.name }}</div>
            </div>
          </div>
        </div>
      </aside>

      <section class="panel p-4 flex flex-col gap-4">
        <div class="flex justify-between items-center gap-3 flex-wrap">
          <div>
            <h2 class="m-0 text-lg font-800">识别结果提取</h2>
            <p class="mt-1 mb-0 text-xs text-ink-soft">单张编辑保存后仍回到待入账汇总。</p>
          </div>
          <button class="btn px-3 py-1.75" type="button" @click="setMode('pending')">返回待入账</button>
        </div>

        <div class="grid grid-cols-2 gap-3.5 max-md:grid-cols-1" @change="invoiceActions.refreshDuplicates">
          <label class="field-label">单据编号<input class="field-input font-mono" v-model="selectedInv.fields.number" /></label>
          <label class="field-label">开票日期<input class="field-input font-mono" v-model="selectedInv.fields.date" placeholder="2026-03-09" @input="syncDate(selectedInv)" /></label>
          <label class="field-label">公司<input class="field-input" v-model="selectedInv.fields.buyer" placeholder="公司名称" /></label>
          <label class="field-label">供应商<input class="field-input" v-model="selectedInv.fields.seller" placeholder="供应商名称" /></label>
          <label class="field-label">类型<input class="field-input" v-model="selectedInv.fields.type" placeholder="发票类型" /></label>
          <label class="field-label">金额<input class="field-input font-mono" v-model="selectedInv.fields.total" inputmode="decimal" /></label>
          <label class="field-label col-span-2 max-md:col-span-1">对应项目<input class="field-input" v-model="selectedInv.fields.project" placeholder="项目名称" /></label>
          <label class="field-label">税额<input class="field-input font-mono" v-model="selectedInv.fields.tax" inputmode="decimal" /></label>
          <label class="field-label">税点<input class="field-input font-mono" v-model="selectedInv.fields.rate" placeholder="如 13%" /></label>
          <label class="field-label col-span-full">票面备注<input class="field-input" v-model="selectedInv.fields.remark" placeholder="发票备注栏内容" /></label>
        </div>

        <div v-if="groupPath(selectedInv).length" class="text-xs text-ink-soft">
          分目录：{{ groupPath(selectedInv).join(" / ") }}
        </div>

        <div class="mt-auto pt-3 border-t border-line flex justify-between items-center gap-3 flex-wrap">
          <button class="btn-danger px-3 py-1.75" type="button" @click="remove(selectedInv)">删除</button>
          <div class="flex gap-2 flex-wrap">
            <button class="btn px-3 py-1.75" type="button" :disabled="selectedInv.rendering || invoiceStore.busy" @click="recognize(selectedInv)">重新识别</button>
            <button class="btn-primary px-4 py-1.75" type="button" :disabled="selectedInv.status !== 'done'" @click="postInvoice(selectedInv)">入账</button>
          </div>
        </div>
      </section>
    </section>

    <section v-else-if="viewMode === 'pending'" class="panel overflow-hidden">
      <div class="p-4 border-b border-line bg-[#f8fafc] flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h2 class="m-0 text-lg font-800">待入账条目汇总</h2>
          <p class="mt-1 mb-0 text-xs text-ink-soft">{{ pendingItems.length }} 张待入账，合计 {{ pendingTotal }}</p>
        </div>
        <button class="btn-primary px-4 py-2" type="button" :disabled="!pendingItems.length" @click="postAllPending">批量入账</button>
      </div>

      <div v-if="!pendingItems.length" class="p-8 text-center text-ink-soft">暂无待入账条目。</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[1180px] text-left border-collapse">
          <thead class="bg-[#f8fafc] text-ink-soft text-xs font-800 tracking-wide">
            <tr class="border-b border-line">
              <th class="px-4 py-3">缩略图</th>
              <th class="px-4 py-3">单据编号</th>
              <th class="px-4 py-3">开票日期</th>
              <th class="px-4 py-3">公司</th>
              <th class="px-4 py-3">供应商</th>
              <th class="px-4 py-3">类型</th>
              <th class="px-4 py-3 text-right">金额</th>
              <th class="px-4 py-3">对应项目</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="item in pendingItems" :key="item.inv.id" :data-inv="item.inv.id" class="hover:bg-[#f8fafc]">
              <td class="px-4 py-3">
                <div class="w-12 h-15 rounded-lg border border-line bg-[#f3f4f6] overflow-hidden grid place-items-center">
                  <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-brand font-800">票</span>
                </div>
              </td>
              <td class="px-4 py-3 font-mono font-700">{{ docNo(item) }}</td>
              <td class="px-4 py-3 font-mono text-ink-soft">{{ item.inv.fields.date || "待补" }}</td>
              <td class="px-4 py-3 max-w-48 truncate" :title="item.inv.fields.buyer">{{ item.inv.fields.buyer || "待补" }}</td>
              <td class="px-4 py-3 max-w-56 truncate" :title="item.inv.fields.seller">{{ item.inv.fields.seller || "待补" }}</td>
              <td class="px-4 py-3">{{ docType(item.inv) }}</td>
              <td class="px-4 py-3 text-right font-mono font-800 text-brand">{{ money(amountValue(item.inv)) }}</td>
              <td class="px-4 py-3 max-w-52 truncate" :title="projectText(item.inv)">{{ projectText(item.inv) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="btn-danger px-2.5 py-1.5 text-xs" type="button" @click="remove(item.inv)">删除</button>
                <button class="btn px-2.5 py-1.5 text-xs ml-1.5" type="button" @click="editSingle(item.inv)">编辑</button>
                <button class="btn-primary px-2.5 py-1.5 text-xs ml-1.5" type="button" @click="postInvoice(item.inv)">入账</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-else-if="viewMode === 'posted'" class="panel overflow-hidden">
      <div class="p-4 border-b border-line bg-[#f8fafc] flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h2 class="m-0 text-lg font-800">已入账</h2>
          <p class="mt-1 mb-0 text-xs text-ink-soft">{{ postedItems.length }} 张已入账，合计 {{ postedTotal }}</p>
        </div>
        <button class="btn px-4 py-2" type="button" @click="setMode('pending')">查看待入账</button>
      </div>

      <div v-if="!postedItems.length" class="p-8 text-center text-ink-soft">暂无已入账条目。</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[1260px] text-left border-collapse">
          <thead class="bg-[#f8fafc] text-ink-soft text-xs font-800 tracking-wide">
            <tr class="border-b border-line">
              <th class="px-4 py-3">缩略图</th>
              <th class="px-4 py-3">单据编号</th>
              <th class="px-4 py-3">开票日期</th>
              <th class="px-4 py-3">公司</th>
              <th class="px-4 py-3">供应商</th>
              <th class="px-4 py-3">类型</th>
              <th class="px-4 py-3 text-right">金额</th>
              <th class="px-4 py-3">对应项目</th>
              <th class="px-4 py-3">入账时间</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-line">
            <tr v-for="item in postedItems" :key="item.inv.id" :data-inv="item.inv.id" class="hover:bg-[#f8fafc]">
              <td class="px-4 py-3">
                <div class="w-12 h-15 rounded-lg border border-line bg-[#f3f4f6] overflow-hidden grid place-items-center">
                  <img v-if="thumbnail(item.inv)" :src="thumbnail(item.inv)" class="w-full h-full object-cover" alt="" />
                  <span v-else class="text-brand font-800">票</span>
                </div>
              </td>
              <td class="px-4 py-3 font-mono font-700">{{ docNo(item) }}</td>
              <td class="px-4 py-3 font-mono text-ink-soft">{{ item.inv.fields.date || "待补" }}</td>
              <td class="px-4 py-3 max-w-48 truncate" :title="item.inv.fields.buyer">{{ item.inv.fields.buyer || "待补" }}</td>
              <td class="px-4 py-3 max-w-56 truncate" :title="item.inv.fields.seller">{{ item.inv.fields.seller || "待补" }}</td>
              <td class="px-4 py-3">{{ docType(item.inv) }}</td>
              <td class="px-4 py-3 text-right font-mono font-800 text-brand">{{ money(amountValue(item.inv)) }}</td>
              <td class="px-4 py-3 max-w-52 truncate" :title="projectText(item.inv)">{{ projectText(item.inv) }}</td>
              <td class="px-4 py-3 text-ink-soft font-mono">{{ postedTime(item.inv) }}</td>
              <td class="px-4 py-3 text-right whitespace-nowrap">
                <button class="btn px-2.5 py-1.5 text-xs" type="button" @click="editSingle(item.inv)">编辑</button>
                <button class="btn px-2.5 py-1.5 text-xs ml-1.5" type="button" @click="moveBackToPending(item.inv)">移回待入账</button>
                <button class="btn-danger px-2.5 py-1.5 text-xs ml-1.5" type="button" @click="remove(item.inv)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

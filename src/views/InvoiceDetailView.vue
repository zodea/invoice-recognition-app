<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { invoiceStore, invoiceActions, groupPath } from "../invoiceStore";
import { renderPdfPages } from "../lib/pdftext";
import { collectFromInvoices } from "../lib/supplier-db";
import { useSupplierStore } from "../stores/supplier";
import { toastInfo, toastWarn } from "../lib/toast";

const route = useRoute();
const router = useRouter();
const supplierStore = useSupplierStore();

const inv = computed(() => invoiceStore.invoices.find((i) => i.id === route.params.id) || null);

const zoomOpen = ref(false);
const zoomPage = ref(0);
const hiRes = ref({});

function statusText(i) {
  if (!i) return "";
  if (i.rendering) return "读取中";
  if (i.status === "running") return "识别中";
  if (i.status === "error") return "识别失败";
  if (i.duplicateReason) return "重复已排除";
  if (i.history?.usedBefore) return "历史已用";
  if (i.status === "done") return "识别完成";
  return "待识别";
}
function statusClass(i) {
  if (!i) return "chip";
  if (i.status === "error" || i.duplicateReason) return "chip-danger";
  if (i.status === "running" || i.rendering) return "chip-brand";
  if (i.history?.usedBefore) return "chip-warn";
  if (i.status === "done") return "chip-ok";
  return "chip bg-surface-3 text-ink-soft";
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && v !== "" ? `¥${n.toFixed(2)}` : "待补";
}

function pageImages(i) {
  if (!i) return [];
  return i.renderedPages?.length ? i.renderedPages : i.pages?.map((p) => p.dataUrl).filter(Boolean) || [];
}

function syncDate() {
  if (inv.value) inv.value.fields.dateText = inv.value.fields.date;
}

async function recognize() {
  if (!inv.value || invoiceStore.busy || inv.value.rendering) return;
  await invoiceActions.recognizeOne(inv.value);
}

function remove() {
  if (!inv.value) return;
  invoiceActions.removeInvoice(inv.value.id);
  router.push("/invoice");
}

function postInvoice() {
  const i = inv.value;
  if (!i) return;
  if (i.status !== "done") { toastWarn("请先完成识别，再进行入账。"); return; }
  invoiceActions.markAccounted(i);
  const r = collectFromInvoices(supplierStore.list, [i]);
  if (r.added || r.updated) supplierStore.persist();
  toastInfo("已移动到已入账。");
  router.push("/invoice");
}

function moveBack() {
  if (!inv.value) return;
  invoiceActions.markPending(inv.value);
  toastInfo("已移回待入账。");
  router.push("/invoice");
}

async function rotatePage(page, dir) {
  if (!inv.value) return;
  await invoiceActions.rotateInvoice(inv.value, dir, page);
  if (zoomOpen.value) await loadHiRes(inv.value, page);
}

function hiResKey(i, page) {
  const rot = i.pageRotations?.[page] ?? i.rotation ?? 0;
  return `${i.id}:${page}:${rot}`;
}

async function loadHiRes(i, page) {
  if (!i?.isTextPdf || !i.blob) return;
  const key = hiResKey(i, page);
  if (hiRes.value[key]) return;
  try {
    const pr = i.pageRotations || {};
    const hp = await renderPdfPages(i.blob, {
      scale: 3,
      rotation: i.rotation,
      pageRotations: Object.keys(pr).length ? pr : undefined,
    });
    const hi = hp[page] || hp[0];
    if (hi) hiRes.value = { ...hiRes.value, [key]: hi };
  } catch (_) { /* keep low-res */ }
}

function zoomSrc() {
  const i = inv.value;
  if (!i) return null;
  return hiRes.value[hiResKey(i, zoomPage.value)] || pageImages(i)[zoomPage.value];
}

async function openZoom(page) {
  zoomPage.value = page;
  zoomOpen.value = true;
  if (inv.value) await loadHiRes(inv.value, page);
}

function onKey(e) {
  if (!zoomOpen.value) return;
  if (e.key === "Escape") zoomOpen.value = false;
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  for (const u of Object.values(hiRes.value)) if (typeof u === "string" && u.startsWith("blob:")) URL.revokeObjectURL(u);
});
</script>

<template>
  <div v-if="!inv" class="panel p-6 text-center text-ink-soft">
    未找到该发票，可能已被删除。
    <button class="btn px-2.5 py-1 ml-2" @click="router.push('/invoice')">返回列表</button>
  </div>

  <div v-else class="flex flex-col gap-4">
    <!-- 顶部信息栏 -->
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <button class="btn px-2.5 py-1.5" @click="router.push('/invoice')">
        <span class="i-lucide-arrow-left w-4 h-4 flex-none"></span>
        返回
      </button>
      <h2 class="m-0 text-base font-800 truncate max-w-80" :title="inv.name">{{ inv.fields.number || inv.name }}</h2>
      <span :class="statusClass(inv)">{{ statusText(inv) }}</span>
      <span v-if="inv.accountStatus === 'posted'" class="chip-ok">已入账</span>
      <span v-if="inv.fields.total" class="ml-auto text-lg font-800 font-mono text-brand">{{ money(inv.fields.total) }}</span>
    </div>

    <!-- 两栏：预览 + 表单 -->
    <div class="grid grid-cols-[minmax(320px,1fr)_minmax(380px,1fr)] gap-4 lt-md:grid-cols-1">
      <!-- 左：预览图 -->
      <div class="panel p-3 flex flex-col gap-3 min-h-0">
        <div class="flex items-center justify-between gap-2">
          <h3 class="m-0 text-sm font-700">发票预览</h3>
          <span class="text-xs text-ink-soft">{{ pageImages(inv).length }} 页 · 双击放大</span>
        </div>
        <div v-if="!pageImages(inv).length" class="flex-1 grid place-items-center text-ink-soft p-8 bg-surface-sink rounded-btn border border-dashed border-line-strong">
          预览图尚未生成
        </div>
        <div v-else class="flex flex-col gap-3">
          <div v-for="(src, idx) in pageImages(inv)" :key="idx" class="relative group">
            <div class="bg-white border border-line rounded-btn overflow-hidden cursor-pointer" @dblclick="openZoom(idx)">
              <img :src="src" class="w-full block" alt="" />
            </div>
            <div class="absolute top-2 left-2 flex gap-1">
              <span class="chip bg-ink text-white px-1.5 py-0.5 text-[11px]">{{ idx + 1 }}</span>
            </div>
            <div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn bg-white/90 border border-line text-ink-soft hover:text-brand transition" title="左旋" @click="rotatePage(idx, -1)">
                <span class="i-lucide-rotate-ccw w-3.5 h-3.5"></span>
              </button>
              <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn bg-white/90 border border-line text-ink-soft hover:text-brand transition" title="右旋" @click="rotatePage(idx, 1)">
                <span class="i-lucide-rotate-cw w-3.5 h-3.5"></span>
              </button>
              <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn bg-white/90 border border-line text-ink-soft hover:text-brand transition" title="放大" @click="openZoom(idx)">
                <span class="i-lucide-zoom-in w-3.5 h-3.5"></span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 右：校对表单 -->
      <div class="panel p-4 flex flex-col gap-4">
        <h3 class="m-0 text-sm font-700">识别结果提取</h3>
        <div class="grid grid-cols-2 gap-3.5 lt-md:grid-cols-1" @change="invoiceActions.refreshDuplicates">
          <label class="field-label">单据编号<input class="field-input font-mono" v-model="inv.fields.number" /></label>
          <label class="field-label">开票日期<input class="field-input font-mono" v-model="inv.fields.date" placeholder="2026-03-09" @input="syncDate" /></label>
          <label class="field-label">购买方<input class="field-input" v-model="inv.fields.buyer" placeholder="购买方公司名称" /></label>
          <label class="field-label">供应商<input class="field-input" v-model="inv.fields.seller" placeholder="供应商名称" /></label>
          <label class="field-label">票据类型<input class="field-input" v-model="inv.fields.type" placeholder="如 增值税普通发票" /></label>
          <label class="field-label">金额<input class="field-input font-mono" v-model="inv.fields.total" inputmode="decimal" /></label>
          <label class="field-label col-span-2 lt-md:col-span-1">对应项目<input class="field-input" v-model="inv.fields.project" placeholder="项目名称" /></label>
          <label class="field-label">税额<input class="field-input font-mono" v-model="inv.fields.tax" inputmode="decimal" /></label>
          <label class="field-label">税点<input class="field-input font-mono" v-model="inv.fields.rate" placeholder="如 13%" /></label>
          <label class="field-label col-span-full">票面备注<input class="field-input" v-model="inv.fields.remark" placeholder="发票备注栏内容" /></label>
        </div>
        <div v-if="groupPath(inv).length" class="text-xs text-ink-soft">分目录：{{ groupPath(inv).join(" / ") }}</div>

        <div class="mt-auto pt-3 border-t border-line flex justify-between items-center gap-3 flex-wrap">
          <button class="btn-danger px-3 py-1.75" type="button" @click="remove">
            <span class="i-lucide-trash-2 w-4 h-4 flex-none"></span>
            废弃该单据
          </button>
          <div class="flex gap-2 flex-wrap">
            <button class="btn px-3 py-1.75" type="button" :disabled="inv.rendering || invoiceStore.busy" @click="recognize">
              <span class="i-lucide-refresh-cw w-4 h-4 flex-none"></span>
              重新识别
            </button>
            <button v-if="inv.accountStatus === 'posted'" class="btn px-4 py-1.75" type="button" @click="moveBack">
              <span class="i-lucide-file-output w-4 h-4 flex-none"></span>
              移回待入账
            </button>
            <button v-else class="btn-primary px-4 py-1.75" type="button" :disabled="inv.status !== 'done'" @click="postInvoice">
              <span class="i-lucide-file-check w-4 h-4 flex-none"></span>
              确认并入账
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 放大模式 -->
    <div v-if="zoomOpen" class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center" @click.self="zoomOpen = false">
      <div class="relative max-w-[90vw] max-h-[90vh] overflow-auto bg-white rounded-card shadow-pop">
        <div class="sticky top-0 z-5 flex items-center gap-2 px-3 py-2 bg-white/95 border-b border-line backdrop-blur">
          <button class="btn px-2.5 py-1.5" @click="zoomOpen = false">
            <span class="i-lucide-x w-4 h-4"></span>
            关闭
          </button>
          <button class="btn px-2.5 py-1.5" @click="rotatePage(zoomPage, -1)">
            <span class="i-lucide-rotate-ccw w-4 h-4"></span>
          </button>
          <button class="btn px-2.5 py-1.5" @click="rotatePage(zoomPage, 1)">
            <span class="i-lucide-rotate-cw w-4 h-4"></span>
          </button>
          <span class="text-xs text-ink-soft ml-auto">第 {{ zoomPage + 1 }} 页</span>
        </div>
        <img v-if="zoomSrc()" :src="zoomSrc()" class="block max-w-none w-[80vw]" alt="" />
      </div>
    </div>
  </div>
</template>

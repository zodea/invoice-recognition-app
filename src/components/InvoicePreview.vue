<script setup>
import { computed, onUnmounted, ref } from "vue";
import { invoiceStore, printUnits, selectInvoice } from "../invoiceStore";
import { A4_RATIO, perPageCount, planSlots } from "../lib/print-layout";
import { renderPdfPages } from "../lib/pdftext";

const units = computed(() => printUnits());
const slots = computed(() => planSlots(invoiceStore.perPage));
const pages = computed(() => {
  const per = perPageCount(invoiceStore.perPage);
  const out = [];
  for (let i = 0; i < units.value.length; i += per) out.push(units.value.slice(i, i + per));
  return out;
});

function slotStyle(slot) {
  return { left: `${slot.xPct}%`, top: `${slot.yPct}%`, width: `${slot.wPct}%`, height: `${slot.hPct}%` };
}

/* ---------- 左栏内放大（替代原全屏弹窗）：复用已渲染图秒开 + 指针拖动平移 + 后台缓存高清 ---------- */
const zoomUnit = ref(null); // 当前放大的打印单元
const zoomLevel = ref(1); // 1 = 适应栏宽；>1 放大并可平移
const hiRes = ref({}); // { `${invId}:${page}`: dataUrl } 高清缓存，避免重复渲染
const viewport = ref(null);

const zoomKey = computed(() => (zoomUnit.value ? `${zoomUnit.value.invId}:${zoomUnit.value.page}` : ""));
const zoomSrc = computed(() => (zoomUnit.value ? hiRes.value[zoomKey.value] || zoomUnit.value.image : null));
const zoomWidth = computed(() => `${Math.round(zoomLevel.value * 100)}%`);

async function enterZoom(unit) {
  selectInvoice(unit.invId);
  zoomUnit.value = unit;
  zoomLevel.value = 1;
  // 电子票按需渲染一次高清并缓存；先用已有图秒显，渲染好后无缝替换
  const key = `${unit.invId}:${unit.page}`;
  if (unit.image && unit.inv.isTextPdf && unit.inv.blob && !hiRes.value[key]) {
    try {
      const hp = await renderPdfPages(unit.inv.blob, { scale: 3 });
      const hi = hp[unit.page] || hp[0];
      if (hi) hiRes.value = { ...hiRes.value, [key]: hi };
    } catch (e) {
      /* 渲染失败保留普通预览图 */
    }
  }
}
function exitZoom() {
  zoomUnit.value = null;
}
// 组件卸载（如切到送货单页懒卸载）时回收高清预览图对象 URL
onUnmounted(() => {
  for (const u of Object.values(hiRes.value)) if (typeof u === "string" && u.startsWith("blob:")) URL.revokeObjectURL(u);
});
function stepZoom(d) {
  zoomLevel.value = Math.min(4, Math.max(1, Math.round((zoomLevel.value + d) * 100) / 100));
}
function fitZoom() {
  zoomLevel.value = 1;
}

// 指针拖动平移：用 window 级监听（比 setPointerCapture 更稳），dragging 用 ref 以驱动光标样式
const dragging = ref(false);
let lastX = 0;
let lastY = 0;
function onMove(e) {
  if (!dragging.value || !viewport.value) return;
  viewport.value.scrollLeft -= e.clientX - lastX;
  viewport.value.scrollTop -= e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
}
function onUp() {
  dragging.value = false;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
}
function onDown(e) {
  if (!viewport.value) return;
  dragging.value = true;
  lastX = e.clientX;
  lastY = e.clientY;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return; // 仅 Ctrl/⌘ + 滚轮缩放，普通滚轮照常滚动
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 0.25 : -0.25);
}
</script>

<template>
  <section class="flex flex-col min-h-0">
    <div class="pane-head sticky -top-3 z-4 flex items-center justify-between gap-2.5 -mx-3 -mt-3 mb-2.5 px-3 py-3 bg-[#f8fafc]/96 border-b border-line backdrop-blur">
      <div class="min-w-0">
        <h2 class="m-0 text-base font-700">打印排版</h2>
        <p class="mt-0.25 text-ink-soft text-xs">{{ zoomUnit ? "放大查看 · 拖动可平移" : `${units.length} 个打印位` }}</p>
      </div>
      <span class="chip bg-brand-soft text-brand">{{ invoiceStore.perPage }} 张/页</span>
    </div>

    <!-- 放大模式：在左栏内显示大图，可拖动平移 -->
    <div v-if="zoomUnit" class="flex-1 flex flex-col min-h-0">
      <div class="flex items-center flex-wrap gap-1.5 mb-2">
        <button class="btn px-2.5 py-1.5" title="返回排版" @click="exitZoom">← 返回</button>
        <button class="btn px-2.5 py-1.5" title="缩小" :disabled="zoomLevel <= 1" @click="stepZoom(-0.25)">−</button>
        <span class="min-w-12 text-center text-xs font-700 text-ink-soft tabular-nums">{{ Math.round(zoomLevel * 100) }}%</span>
        <button class="btn px-2.5 py-1.5" title="放大" :disabled="zoomLevel >= 4" @click="stepZoom(0.25)">＋</button>
        <button class="btn px-2.5 py-1.5" title="适应栏宽" @click="fitZoom">适应</button>
        <span class="ml-auto text-xs text-ink-soft truncate max-w-50">
          序号 {{ zoomUnit.seq }}<template v-if="zoomUnit.pageCount > 1">-{{ zoomUnit.page + 1 }}</template>
          · {{ zoomUnit.inv.fields.seller || "未识别销售方" }}
        </span>
      </div>
      <div
        ref="viewport"
        class="relative h-[68vh] overflow-auto rounded-card border border-line bg-[#eef1f5] touch-none"
        :class="zoomLevel > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
        @wheel="onWheel"
      >
        <img
          v-if="zoomSrc"
          :src="zoomSrc"
          :style="{ width: zoomWidth }"
          class="block max-w-none select-none mx-auto bg-white"
          draggable="false"
          alt=""
        />
        <div v-else class="m-auto max-w-100 flex flex-col gap-2 p-12 bg-white rounded-card">
          <strong class="text-lg">{{ zoomUnit.inv.fields.seller || "电子发票 PDF" }}</strong>
          <span class="text-ink-soft">{{ zoomUnit.inv.fields.date || "日期待复核" }}</span>
          <span class="text-ink-soft">{{ zoomUnit.inv.fields.total ? `¥${zoomUnit.inv.fields.total}` : "金额待复核" }}</span>
          <small class="text-ink-soft text-xs break-all">{{ zoomUnit.inv.name }}</small>
        </div>
      </div>
    </div>

    <!-- 网格模式：A4 打印排版 -->
    <template v-else>
      <div v-if="!pages.length" class="border border-dashed border-line-strong rounded-card text-ink-soft px-3 py-7.5 text-center bg-white">
        勾选发票后显示打印排版
      </div>

      <div v-for="(page, pageIndex) in pages" :key="pageIndex" class="mb-3.5">
        <div class="relative w-full bg-white border border-line shadow-card" :style="{ aspectRatio: `1 / ${A4_RATIO}` }">
          <button
            v-for="(unit, unitIndex) in page"
            :key="`${unit.invId}-${unit.page}`"
            class="group absolute p-0 overflow-hidden bg-white cursor-pointer border"
            :class="[
              invoiceStore.selectedId === unit.invId ? 'border-brand z-2 shadow-[0_0_0_2px_rgba(37,99,235,0.22)]' : 'border-line-strong',
              unit.needsReview ? '!border-warn' : '',
            ]"
            :style="slotStyle(slots[unitIndex])"
            :data-inv="unit.invId"
            @click="selectInvoice(unit.invId)"
            @dblclick="enterZoom(unit)"
            @contextmenu.prevent="enterZoom(unit)"
            title="双击 / 右键放大查看"
          >
            <span class="absolute z-3 top-1.25 left-1.25 chip bg-ink text-white px-1.5 py-1">
              {{ unit.seq }}<template v-if="unit.pageCount > 1">-{{ unit.page + 1 }}</template>
            </span>
            <span
              class="absolute z-3 right-1.25 bottom-1.25 w-6 h-6 flex items-center justify-center rounded-md bg-ink/65 text-white text-[13px] opacity-0 group-hover:opacity-100 transition-opacity"
              title="放大查看"
              @click.stop="enterZoom(unit)"
            >🔍</span>
            <span v-if="unit.needsReview" class="absolute z-3 top-1.25 right-1.25 chip bg-[#fff7ed] text-[#b45309] border border-[#fed7aa] px-1.5 py-0.75">待复核</span>
            <img v-if="unit.image" :src="unit.image" class="w-full h-full object-contain block" alt="" />
            <div v-else class="h-full flex flex-col items-start justify-center gap-1.5 px-3.5 pt-5.5 pb-3.5 text-left text-ink">
              <strong class="text-[13px] leading-snug">{{ unit.inv.fields.seller || "电子发票 PDF" }}</strong>
              <span class="text-xs text-ink-soft">{{ unit.inv.fields.date || "日期待复核" }}</span>
              <span class="text-xs text-ink-soft">{{ unit.inv.fields.total ? `¥${unit.inv.fields.total}` : "金额待复核" }}</span>
              <small class="w-full text-ink-soft text-[10px] truncate">{{ unit.inv.name }}</small>
            </div>
          </button>
        </div>
        <div class="mt-1 text-center text-ink-soft text-xs">A4 第 {{ pageIndex + 1 }} 页</div>
      </div>
    </template>
  </section>
</template>

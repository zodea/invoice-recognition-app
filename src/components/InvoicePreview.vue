<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuTrigger,
  SliderRange,
  SliderRoot,
  SliderThumb,
  SliderTrack,
} from "reka-ui";
import { invoiceStore, invoiceActions, printUnits, selectInvoice } from "../invoiceStore";
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

/* ---------- 左栏内放大：复用已渲染图秒开 + 指针拖动平移 + 后台缓存高清 + 左右旋 ---------- */
const zoomUnit = ref(null);
const zoomLevel = ref(1); // 1=适应栏宽；>1 放大并可平移
const hiRes = ref({}); // 高清缓存 key=`${invId}:${page}:${rotation}`
const viewport = ref(null);

const zoomSrc = computed(() => {
  const u = zoomUnit.value;
  if (!u) return null;
  return hiRes.value[`${u.invId}:${u.page}:${u.inv.rotation}`] || u.inv.renderedPages?.[u.page] || u.image;
});
const zoomWidth = computed(() => `${Math.round(zoomLevel.value * 100)}%`);
// reka Slider 用数组；映射到 zoomLevel(100~400 -> 1~4)
const zoomPct = computed({
  get: () => [Math.round(zoomLevel.value * 100)],
  set: (v) => { zoomLevel.value = (v?.[0] ?? 100) / 100; },
});

async function loadHiRes(u) {
  if (!u || !u.inv.isTextPdf || !u.inv.blob) return;
  const key = `${u.invId}:${u.page}:${u.inv.rotation}`;
  if (hiRes.value[key]) return;
  try {
    const hp = await renderPdfPages(u.inv.blob, { scale: 3, rotation: u.inv.rotation });
    const hi = hp[u.page] || hp[0];
    if (hi) hiRes.value = { ...hiRes.value, [key]: hi };
  } catch (e) {
    /* 保留普通预览图 */
  }
}
async function enterZoom(unit) {
  selectInvoice(unit.invId);
  zoomUnit.value = unit;
  zoomLevel.value = 1;
  await loadHiRes(unit);
}
async function rotateZoom(dir) {
  const u = zoomUnit.value;
  if (!u) return;
  await invoiceActions.rotateInvoice(u.inv, dir);
  await loadHiRes(u);
}
function rotateSlot(unit, dir) {
  selectInvoice(unit.invId);
  invoiceActions.rotateInvoice(unit.inv, dir);
}
function exitZoom() {
  zoomUnit.value = null;
}
onUnmounted(() => {
  for (const u of Object.values(hiRes.value)) if (typeof u === "string" && u.startsWith("blob:")) URL.revokeObjectURL(u);
});

// 指针拖动平移（window 级监听，dragging 用 ref 驱动光标）
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
function setZoom(delta) {
  zoomLevel.value = Math.min(4, Math.max(1, Math.round((zoomLevel.value + delta) * 100) / 100));
}
function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(e.deltaY < 0 ? 0.25 : -0.25);
}
// 放大模式键盘快捷键：Esc 退出，+/- 缩放，←/→ 左右旋
function onKey(e) {
  if (!zoomUnit.value) return;
  if (e.key === "Escape") { exitZoom(); }
  else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(0.25); }
  else if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(-0.25); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); rotateZoom(-1); }
  else if (e.key === "ArrowRight") { e.preventDefault(); rotateZoom(1); }
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

const menuItemCls = "flex items-center gap-2 px-2.5 py-1.5 text-sm rounded-md cursor-pointer outline-none text-ink data-[highlighted]:bg-brand-soft data-[highlighted]:text-brand";
</script>

<template>
  <section class="flex flex-col min-h-0">
    <div class="pane-head sticky -top-3 z-5 flex items-center justify-between gap-2.5 -mx-3 -mt-3 mb-2.5 px-3 py-3 bg-[#f8fafc]/96 border-b border-line backdrop-blur">
      <div class="min-w-0">
        <h2 class="m-0 text-base font-700">打印排版</h2>
        <p class="mt-0.25 text-ink-soft text-xs">{{ zoomUnit ? "放大查看 · 拖动平移 · Esc退出 +/-缩放 ←→旋转" : `${units.length} 个打印位 · 右键/双击放大 · 滚轮Ctrl缩放` }}</p>
      </div>
      <span class="chip bg-brand-soft text-brand">{{ invoiceStore.perPage }} 张/页</span>
    </div>

    <!-- 放大模式：固定头部工具栏(缩放滑块/左旋/右旋/退出) + 可拖动大图 -->
    <div v-if="zoomUnit" class="flex-1 flex flex-col min-h-0">
      <div class="sticky top-9 z-4 flex items-center flex-wrap gap-2 mb-2 py-1.5 bg-[#f8fafc]">
        <button class="btn px-2.5 py-1.5" title="退出放大" @click="exitZoom">← 退出</button>
        <button class="btn px-2.5 py-1.5" title="左旋 90°" @click="rotateZoom(-1)">⟲ 左旋</button>
        <button class="btn px-2.5 py-1.5" title="右旋 90°" @click="rotateZoom(1)">⟳ 右旋</button>
        <div class="flex items-center gap-2 ml-1">
          <span class="text-xs text-ink-soft">缩放</span>
          <SliderRoot
            v-model="zoomPct"
            :min="100"
            :max="400"
            :step="5"
            class="relative flex items-center select-none touch-none w-36 h-5"
          >
            <SliderTrack class="relative grow rounded-full bg-line h-1.5">
              <SliderRange class="absolute rounded-full bg-brand h-full" />
            </SliderTrack>
            <SliderThumb class="block w-3.5 h-3.5 rounded-full bg-white border-2 border-brand shadow-card cursor-grab" />
          </SliderRoot>
          <span class="min-w-10 text-xs font-700 text-ink-soft tabular-nums">{{ Math.round(zoomLevel * 100) }}%</span>
        </div>
        <span class="ml-auto text-xs text-ink-soft truncate max-w-44">
          序号 {{ zoomUnit.seq }}<template v-if="zoomUnit.pageCount > 1">-{{ zoomUnit.page + 1 }}</template>
          · {{ zoomUnit.inv.fields.seller || "未识别销售方" }}
        </span>
      </div>
      <div
        ref="viewport"
        class="relative h-[64vh] overflow-auto rounded-card border border-line bg-surface-sink touch-none p-3"
        :class="zoomLevel > 1 ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'"
        @pointerdown="onDown"
        @wheel="onWheel"
      >
        <img
          v-if="zoomSrc"
          :src="zoomSrc"
          :style="{ width: zoomWidth }"
          class="block max-w-none select-none bg-white"
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

    <!-- 网格模式：A4 排版；右键槽位弹菜单(放大/左旋/右旋) -->
    <template v-else>
      <div v-if="!pages.length" class="border border-dashed border-line-strong rounded-card text-ink-soft px-3 py-7.5 text-center bg-white">
        勾选发票后显示打印排版
      </div>

      <div v-for="(page, pageIndex) in pages" :key="pageIndex" class="mb-3.5">
        <div class="relative w-full bg-white border border-line shadow-card" :style="{ aspectRatio: `1 / ${A4_RATIO}` }">
          <ContextMenuRoot v-for="(unit, unitIndex) in page" :key="`${unit.invId}-${unit.page}`">
            <ContextMenuTrigger as-child>
              <button
                class="absolute p-0 overflow-hidden bg-white cursor-pointer border"
                :class="[
                  invoiceStore.selectedId === unit.invId ? 'border-brand z-2 shadow-[0_0_0_2px_rgba(37,99,235,0.22)]' : 'border-line-strong',
                  unit.needsReview ? '!border-warn' : '',
                ]"
                :style="slotStyle(slots[unitIndex])"
                :data-inv="unit.invId"
                @click="selectInvoice(unit.invId)"
                @dblclick="enterZoom(unit)"
                title="右键：放大 / 左旋 / 右旋；双击放大"
              >
                <span class="absolute z-3 top-1.25 left-1.25 chip bg-ink text-white px-1.5 py-1">
                  {{ unit.seq }}<template v-if="unit.pageCount > 1">-{{ unit.page + 1 }}</template>
                </span>
                <span v-if="unit.needsReview" class="absolute z-3 top-1.25 right-1.25 chip bg-[#fff7ed] text-[#b45309] border border-[#fed7aa] px-1.5 py-0.75">待复核</span>
                <img v-if="unit.image" :src="unit.image" class="w-full h-full object-contain block" alt="" />
                <div v-else class="h-full flex flex-col items-start justify-center gap-1.5 px-3.5 pt-5.5 pb-3.5 text-left text-ink">
                  <strong class="text-[13px] leading-snug">{{ unit.inv.fields.seller || "电子发票 PDF" }}</strong>
                  <span class="text-xs text-ink-soft">{{ unit.inv.fields.date || "日期待复核" }}</span>
                  <span class="text-xs text-ink-soft">{{ unit.inv.fields.total ? `¥${unit.inv.fields.total}` : "金额待复核" }}</span>
                  <small class="w-full text-ink-soft text-[10px] truncate">{{ unit.inv.name }}</small>
                </div>
              </button>
            </ContextMenuTrigger>
            <ContextMenuPortal>
              <ContextMenuContent class="z-50 min-w-32 bg-white border border-line-strong rounded-lg shadow-pop p-1 flex flex-col gap-0.5">
                <ContextMenuItem :class="menuItemCls" @select="enterZoom(unit)">🔍 放大</ContextMenuItem>
                <ContextMenuItem :class="menuItemCls" @select="rotateSlot(unit, -1)">⟲ 左旋 90°</ContextMenuItem>
                <ContextMenuItem :class="menuItemCls" @select="rotateSlot(unit, 1)">⟳ 右旋 90°</ContextMenuItem>
              </ContextMenuContent>
            </ContextMenuPortal>
          </ContextMenuRoot>
        </div>
        <div class="mt-1 text-center text-ink-soft text-xs">A4 第 {{ pageIndex + 1 }} 页</div>
      </div>
    </template>
  </section>
</template>

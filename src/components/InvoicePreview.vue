<script setup>
import { computed, ref } from "vue";
import { invoiceStore, printUnits, selectInvoice } from "../invoiceStore";
import { A4_RATIO, perPageCount, planSlots } from "../lib/print-layout";
import { renderPdfPages } from "../lib/pdftext";

const units = computed(() => printUnits());

// 放大查看：右键槽位或点放大按钮，弹层显示该页大图；电子票按需渲染高清(scale 3)更清晰。
const zoom = ref(null); // { unit, image, loading }
async function openZoom(unit) {
  selectInvoice(unit.invId);
  zoom.value = { unit, image: unit.image, loading: false };
  if (unit.inv.isTextPdf && unit.inv.blob) {
    zoom.value.loading = true;
    try {
      const pages = await renderPdfPages(unit.inv.blob, { scale: 3 });
      const hi = pages[unit.page] || pages[0];
      if (hi && zoom.value && zoom.value.unit === unit) zoom.value.image = hi;
    } catch (e) {
      /* 渲染失败保留已有预览图 */
    } finally {
      if (zoom.value && zoom.value.unit === unit) zoom.value.loading = false;
    }
  }
}
function closeZoom() {
  zoom.value = null;
}
const slots = computed(() => planSlots(invoiceStore.perPage));
const pages = computed(() => {
  const per = perPageCount(invoiceStore.perPage);
  const out = [];
  for (let i = 0; i < units.value.length; i += per) out.push(units.value.slice(i, i + per));
  return out;
});

function slotStyle(slot) {
  return {
    left: `${slot.xPct}%`,
    top: `${slot.yPct}%`,
    width: `${slot.wPct}%`,
    height: `${slot.hPct}%`,
  };
}
</script>

<template>
  <section class="preview-shell">
    <div class="pane-head">
      <div>
        <h2>打印排版</h2>
        <p>{{ units.length }} 个打印位</p>
      </div>
      <span>{{ invoiceStore.perPage }} 张/页</span>
    </div>

    <div v-if="!pages.length" class="preview-empty">勾选发票后显示打印排版</div>

    <div v-for="(page, pageIndex) in pages" :key="pageIndex" class="paper-wrap">
      <div class="paper" :style="{ aspectRatio: `1 / ${A4_RATIO}` }">
        <button
          v-for="(unit, unitIndex) in page"
          :key="`${unit.invId}-${unit.page}`"
          class="slot"
          :class="{ selected: invoiceStore.selectedId === unit.invId, review: unit.needsReview }"
          :style="slotStyle(slots[unitIndex])"
          :data-inv="unit.invId"
          @click="selectInvoice(unit.invId)"
          @contextmenu.prevent="openZoom(unit)"
          title="右键放大查看"
        >
          <span class="seq">
            {{ unit.seq }}<template v-if="unit.pageCount > 1">-{{ unit.page + 1 }}</template>
          </span>
          <span class="zoom-btn" title="放大查看" @click.stop="openZoom(unit)">🔍</span>
          <span v-if="unit.needsReview" class="review-tag">待复核</span>
          <img v-if="unit.image" :src="unit.image" alt="" />
          <div v-else class="pdf-card">
            <strong>{{ unit.inv.fields.seller || "电子发票 PDF" }}</strong>
            <span>{{ unit.inv.fields.date || "日期待复核" }}</span>
            <span>{{ unit.inv.fields.total ? `¥${unit.inv.fields.total}` : "金额待复核" }}</span>
            <small>{{ unit.inv.name }}</small>
          </div>
        </button>
      </div>
      <div class="page-no">A4 第 {{ pageIndex + 1 }} 页</div>
    </div>

    <div v-if="zoom" class="zoom-overlay" @click="closeZoom">
      <div class="zoom-box" @click.stop>
        <button class="zoom-close" @click="closeZoom" title="关闭">✕</button>
        <img v-if="zoom.image" :src="zoom.image" class="zoom-img" alt="" />
        <div v-else class="zoom-card">
          <strong>{{ zoom.unit.inv.fields.seller || "电子发票 PDF" }}</strong>
          <span>{{ zoom.unit.inv.fields.date || "日期待复核" }}</span>
          <span>{{ zoom.unit.inv.fields.total ? `¥${zoom.unit.inv.fields.total}` : "金额待复核" }}</span>
          <small>{{ zoom.unit.inv.name }}</small>
        </div>
        <div v-if="zoom.loading" class="zoom-loading">高清渲染中…</div>
        <div class="zoom-meta">
          序号 {{ zoom.unit.seq }}<template v-if="zoom.unit.pageCount > 1">-{{ zoom.unit.page + 1 }}</template>
          · {{ zoom.unit.inv.fields.seller || "未识别销售方" }}
          · {{ zoom.unit.inv.fields.date || "无日期" }}
          · ¥{{ zoom.unit.inv.fields.total || "0.00" }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.preview-shell {
  min-height: 0;
}
.pane-head {
  position: sticky;
  top: -12px;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: -12px -12px 10px;
  padding: 12px;
  background: rgba(248, 250, 252, 0.96);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(6px);
}
.pane-head h2 {
  margin: 0;
  font-size: 16px;
}
.pane-head p {
  margin: 1px 0 0;
  color: var(--ink-soft);
  font-size: 12px;
}
.pane-head span {
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
}
.preview-empty {
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  color: var(--ink-soft);
  padding: 30px 12px;
  text-align: center;
  background: #fff;
}
.paper-wrap {
  margin-bottom: 14px;
}
.paper {
  position: relative;
  width: 100%;
  background: #fff;
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
}
.slot {
  position: absolute;
  border: 1px solid var(--line-strong);
  background: #fff;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
}
.slot.selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.22);
  z-index: 2;
}
.slot.review {
  border-color: #f59e0b;
}
.slot img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.seq,
.review-tag {
  position: absolute;
  z-index: 3;
  top: 5px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  font-weight: 800;
}
.seq {
  left: 5px;
  background: var(--ink);
  color: #fff;
  padding: 4px 6px;
}
.review-tag {
  right: 5px;
  background: #fff7ed;
  color: #b45309;
  border: 1px solid #fed7aa;
  padding: 3px 6px;
}
.zoom-btn {
  position: absolute;
  z-index: 3;
  right: 5px;
  bottom: 5px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: rgba(31, 35, 41, 0.66);
  color: #fff;
  font-size: 13px;
  opacity: 0;
  transition: opacity 0.12s;
}
.slot:hover .zoom-btn {
  opacity: 1;
}
.zoom-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(15, 23, 42, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.zoom-box {
  position: relative;
  max-width: 94vw;
  max-height: 92vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.zoom-img {
  max-width: 94vw;
  max-height: 82vh;
  object-fit: contain;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.zoom-card {
  background: #fff;
  border-radius: 8px;
  padding: 40px 48px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 320px;
}
.zoom-card strong { font-size: 18px; }
.zoom-card span { color: var(--ink-soft); }
.zoom-card small { color: var(--ink-soft); font-size: 12px; }
.zoom-close {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  border: none;
  background: #fff;
  color: var(--ink);
  font-size: 16px;
  font-weight: 800;
  box-shadow: var(--shadow);
}
.zoom-loading {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(31, 35, 41, 0.8);
  color: #fff;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 12px;
}
.zoom-meta {
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
.pdf-card {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 6px;
  padding: 22px 14px 14px;
  text-align: left;
  color: var(--ink);
}
.pdf-card strong {
  font-size: 13px;
  line-height: 1.35;
}
.pdf-card span {
  font-size: 12px;
  color: var(--ink-soft);
}
.pdf-card small {
  width: 100%;
  color: var(--ink-soft);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.page-no {
  margin-top: 4px;
  color: var(--ink-soft);
  font-size: 12px;
  text-align: center;
}
</style>

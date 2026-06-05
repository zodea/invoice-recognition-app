<script setup>
import { computed } from "vue";
import { invoiceStore, printUnits, selectInvoice } from "../invoiceStore";
import { A4_RATIO, perPageCount, planSlots } from "../lib/print-layout";

const units = computed(() => printUnits());
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
        >
          <span class="seq">
            {{ unit.seq }}<template v-if="unit.pageCount > 1">-{{ unit.page + 1 }}</template>
          </span>
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

<script setup>
import { computed, nextTick, watch } from "vue";
import { invoiceStore, invoiceActions, sortedInvoices, buyerOptions, docTypeOptions } from "../invoiceStore";
import InvoiceUpload from "../components/InvoiceUpload.vue";
import InvoicePreview from "../components/InvoicePreview.vue";
import InvoiceRow from "../components/InvoiceRow.vue";
import InvoicePrintPanel from "../components/InvoicePrintPanel.vue";

const sorted = computed(() => sortedInvoices());
const unrecognizedCount = computed(() => invoiceStore.invoices.filter((i) => i.status !== "done").length);
const buyers = computed(() => buyerOptions());
const docTypes = computed(() => docTypeOptions());

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
</script>

<template>
  <div class="wrap">
    <div class="top-grid">
      <InvoiceUpload />
      <InvoicePrintPanel />
    </div>

    <div class="toolbar" v-if="invoiceStore.invoices.length">
      <div class="toolbar-summary">
        <strong>{{ invoiceStore.invoices.length }}</strong> 张发票
        <span v-if="unrecognizedCount">，{{ unrecognizedCount }} 张未识别</span>
        <span v-else>，全部已识别</span>
      </div>
      <div class="toolbar-actions">
        <button class="tool primary" :disabled="invoiceStore.busy || !unrecognizedCount" @click="invoiceActions.recognizeAll">
          {{ invoiceStore.busy ? "识别中…" : "全部识别" }}
        </button>
        <button class="tool ghost" @click="invoiceActions.clearAll">清空</button>
      </div>
      <span class="msg" v-if="invoiceStore.msg">{{ invoiceStore.msg }}</span>
    </div>

    <div class="filters" v-if="invoiceStore.invoices.length">
      <div class="filter-group">
        <span>购买方</span>
        <button
          v-for="buyer in buyers"
          :key="buyer"
          :class="{ active: invoiceStore.buyerFilter === buyer }"
          @click="invoiceStore.buyerFilter = buyer"
        >
          {{ buyer }}
        </button>
      </div>
      <div class="filter-group">
        <span>类型</span>
        <button
          v-for="docType in docTypes"
          :key="docType"
          :class="{ active: invoiceStore.docTypeFilter === docType }"
          @click="invoiceStore.docTypeFilter = docType"
        >
          {{ docType }}
        </button>
      </div>
    </div>

    <div v-if="invoiceStore.invoices.length" class="workspace">
      <aside class="preview-pane">
        <InvoicePreview />
      </aside>

      <section class="review-pane">
        <div class="pane-head">
          <div>
            <h2>识别内容</h2>
            <p>{{ sorted.length }} 张发票</p>
          </div>
        </div>
        <div class="rows">
          <InvoiceRow v-for="item in sorted" :key="item.inv.id" :item="item" />
        </div>
      </section>
    </div>

    <div v-else class="empty">还没有发票。把电子发票 PDF 或扫描件拖到上面。</div>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.top-grid {
  display: grid;
  grid-template-columns: minmax(340px, 1fr) minmax(420px, 0.9fr);
  gap: 12px;
  align-items: stretch;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.toolbar-summary {
  color: var(--ink-soft);
}
.toolbar-summary strong {
  color: var(--ink);
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tool {
  border: 1px solid var(--line-strong);
  background: #fff;
  border-radius: 6px;
  padding: 6px 10px;
  font-weight: 700;
}
.tool.primary {
  border-color: var(--brand);
  background: var(--brand);
  color: #fff;
}
.tool.ghost {
  color: var(--ink-soft);
}
.tool:disabled {
  opacity: 0.5;
  cursor: default;
}
.msg {
  color: var(--ink-soft);
}
.filters {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.filter-group {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
}
.filter-group span {
  flex: 0 0 auto;
  color: var(--ink-soft);
  font-weight: 700;
  font-size: 12px;
}
.filter-group button {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink);
  border-radius: 999px;
  padding: 4px 9px;
  font-size: 12px;
  font-weight: 700;
}
.filter-group button.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}
.workspace {
  display: grid;
  grid-template-columns: minmax(360px, 0.9fr) minmax(520px, 1.35fr);
  gap: 14px;
  align-items: start;
}
.preview-pane,
.review-pane {
  min-height: 0;
  max-height: calc(100vh - 250px);
  overflow: auto;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 8px;
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
.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.empty {
  text-align: center;
  color: var(--ink-soft);
  padding: 30px;
  background: var(--panel);
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
}
@media (max-width: 980px) {
  .top-grid,
  .workspace {
    grid-template-columns: 1fr;
  }
  .preview-pane,
  .review-pane {
    max-height: none;
  }
}
</style>

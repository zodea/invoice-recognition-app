<script setup>
import { ref } from "vue";
import { invoiceStore, invoiceActions, selectInvoice, groupPath } from "../invoiceStore";
import { invoiceExportFileName } from "../lib/invoice-export-package";

defineProps({ item: Object });

const showText = ref(false);

function syncDate(inv) {
  inv.fields.dateText = inv.fields.date;
}
</script>

<template>
  <article
    class="invoice-row"
    :class="{ selected: invoiceStore.selectedId === item.inv.id, off: !item.inv.include, review: item.needsReview }"
    :data-inv="item.inv.id"
    @click="selectInvoice(item.inv.id)"
  >
    <div class="row-top">
      <div class="title-block">
        <div class="title-line">
          <span class="seq">{{ item.seq }}</span>
          <span class="file" :title="item.inv.name">{{ item.inv.name }}</span>
          <span v-if="item.inv.duplicateReason" class="tag duplicate">重复</span>
          <span v-if="item.inv.history?.printed" class="tag printed">历史已打印</span>
          <span v-else-if="item.inv.history?.verified" class="tag printed">历史已认证</span>
          <span v-else-if="item.needsReview" class="tag">待复核</span>
        </div>
        <div class="export-name" :title="invoiceExportFileName(item.inv)">
          整理后：{{ invoiceExportFileName(item.inv) }}
        </div>
        <div v-if="groupPath(item.inv).length" class="group-path">📁 {{ groupPath(item.inv).join(" / ") }}</div>
      </div>
      <div class="row-actions">
        <label class="include" @click.stop>
          <input type="checkbox" v-model="item.inv.include" />
          打印/汇总
        </label>
        <button :disabled="item.inv.rendering || invoiceStore.busy" @click.stop="invoiceActions.recognizeOne(item.inv)">
          {{ item.inv.status === "running" ? "识别中" : "识别" }}
        </button>
        <button v-if="item.inv.rawText" @click.stop="showText = !showText">{{ showText ? "收起文本" : "文本" }}</button>
        <button class="danger" @click.stop="invoiceActions.removeInvoice(item.inv.id)">移除</button>
      </div>
    </div>

    <div class="state-line">
      <span v-if="item.inv.rendering">读取中…</span>
      <span v-else-if="item.inv.status === 'done'" class="ok">已识别</span>
      <span v-else-if="item.inv.status === 'error'" class="bad">{{ item.inv.error }}</span>
      <span v-else>未识别</span>
      <span v-if="item.inv.systemNote" class="system-note">{{ item.inv.systemNote }}</span>
      <span v-if="item.inv.duplicateReason" class="system-note">{{ item.inv.duplicateReason }}</span>
      <span v-if="item.inv.history?.usedBefore" class="system-note">
        历史台账已记录，{{ item.inv.history.printed ? "已打印" : "已认证" }}
      </span>
    </div>

    <div v-if="showText && item.inv.rawText" class="raw"><pre>{{ item.inv.rawText }}</pre></div>

    <div class="fields" @change="invoiceActions.refreshDuplicates">
      <label>发票号码<input v-model="item.inv.fields.number" /></label>
      <label>开票日期<input v-model="item.inv.fields.date" placeholder="2026-03-09" @input="syncDate(item.inv)" /></label>
      <label class="wide">销售方<input v-model="item.inv.fields.seller" /></label>
      <label class="wide">购买方<input v-model="item.inv.fields.buyer" placeholder="未识别（留空）" /></label>
      <label>金额<input v-model="item.inv.fields.amount" inputmode="decimal" /></label>
      <label>税额<input v-model="item.inv.fields.tax" inputmode="decimal" /></label>
      <label>价税合计<input v-model="item.inv.fields.total" inputmode="decimal" /></label>
      <label>税点<input v-model="item.inv.fields.rate" placeholder="如 13%（混票留空）" /></label>
      <label>类型<input v-model="item.inv.fields.type" placeholder="未识别（留空）" /></label>
      <label class="full">票面备注<input v-model="item.inv.fields.remark" placeholder="发票备注栏内容" /></label>
    </div>
  </article>
</template>

<style scoped>
.invoice-row {
  background: #fff;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  box-shadow: var(--shadow);
}
.invoice-row.selected {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
}
.invoice-row.off {
  opacity: 0.58;
}
.invoice-row.review:not(.selected) {
  border-color: #fed7aa;
}
.row-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.title-block {
  min-width: 0;
  flex: 1 1 auto;
}
.title-line {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
}
.export-name {
  margin: 3px 0 0 33px;
  color: var(--brand);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.group-path {
  margin: 2px 0 0 33px;
  color: var(--ink-soft);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.seq {
  flex: 0 0 auto;
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--ink);
  color: #fff;
  font-weight: 800;
  font-size: 12px;
}
.file {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
}
.tag {
  flex: 0 0 auto;
  color: #b45309;
  background: #fff7ed;
  border: 1px solid #fed7aa;
  border-radius: 999px;
  padding: 2px 7px;
  font-size: 12px;
  font-weight: 700;
}
.tag.duplicate {
  color: #991b1b;
  background: #fef2f2;
  border-color: #fecaca;
}
.tag.printed {
  color: #166534;
  background: #f0fdf4;
  border-color: #bbf7d0;
}
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}
.include {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-soft);
  font-size: 12px;
}
button {
  border: 1px solid var(--line-strong);
  background: #fff;
  border-radius: 6px;
  padding: 4px 8px;
  font-weight: 700;
  font-size: 12px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button.danger {
  color: var(--danger);
}
.state-line {
  margin: 7px 0 8px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--ink-soft);
  font-size: 12px;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--danger);
}
.system-note {
  color: #b45309;
}
.raw {
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
}
.raw pre {
  margin: 0;
  max-height: 150px;
  overflow: auto;
  white-space: pre-wrap;
  font-size: 12px;
}
.fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}
label {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: var(--ink-soft);
  font-size: 12px;
}
label.wide {
  grid-column: span 2;
}
label.full {
  grid-column: 1 / -1;
}
input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 5px 7px;
  color: var(--ink);
  background: #fff;
  font: inherit;
}
@media (max-width: 860px) {
  .row-top {
    flex-direction: column;
  }
  .row-actions {
    justify-content: flex-start;
  }
  .fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

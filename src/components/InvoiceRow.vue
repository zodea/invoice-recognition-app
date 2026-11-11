<script setup>
import SupplierMatch from './SupplierMatch.vue';
import { ref } from "vue";
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
import { invoiceStore, invoiceActions, selectInvoice, groupPath } from "../invoiceStore";
import { invoiceExportFileName } from "../lib/invoice-export-package";
import { EXPENSE_TAGS, inferExpenseTag } from "../lib/invoice-tags";
import { toastWarn } from "../lib/toast";
import SearchSelect from './SearchSelect.vue';
import { directory } from '../lib/expense-directory.js';
import MiddleEllipsis from "./MiddleEllipsis.vue";

defineProps({ item: Object, reimbursementSelected: Boolean });
const emit = defineEmits(["select-reimbursement"]);

const showText = ref(false);

function syncDate(inv) {
  inv.fields.dateText = inv.fields.date;
}
function setIncluded(inv, checked) {
  if (checked && inv.history?.entry?.reimbursement === "已报销" && !window.confirm(`这张发票已报销${inv.history.entry.reimbursementDate ? '（' + inv.history.entry.reimbursementDate + '）' : ''}，可能重复报销。仍要加入打印和汇总吗？`)) return;
  inv.include = checked;
  inv.includeTouched = true;
}
function changeTag(inv, event) {
  try {
    const result = invoiceActions.setInvoiceExpenseTag(inv, event.target.value);
    if (!result.ok) { toastWarn(result.message); event.target.value = inv.history?.entry?.expenseTag || inferExpenseTag(inv); }
  } catch (err) { toastWarn(`标签保存失败：${err.message || err}`); }
}
const tagBase = "chip flex-none px-1.75 py-0.5 border";
</script>

<template>
  <article
    class="bg-white border rounded-lg p-2.5 shadow-card"
    :class="[
      invoiceStore.selectedId === item.inv.id ? 'border-brand shadow-[0_0_0_2px_rgba(37,99,235,0.18)]' : 'border-line',
      !item.inv.include ? 'opacity-58' : '',
      item.needsReview && invoiceStore.selectedId !== item.inv.id ? '!border-[#fed7aa]' : '',
    ]"
    :data-inv="item.inv.id"
    @click="selectInvoice(item.inv.id)"
  >
    <div class="flex items-start justify-between gap-2.5 max-md:flex-col">
      <div class="min-w-0 flex-1">
        <div class="min-w-0 flex items-center gap-1.75">
          <span class="flex-none min-w-6.5 h-6.5 inline-flex items-center justify-center rounded-full bg-ink text-white font-800 text-xs">{{ item.seq }}</span>
          <label class="inline-flex items-center gap-1 text-xs flex-none" @click.stop><input type="checkbox" :checked="reimbursementSelected" :aria-label="`选择 ${item.inv.name} 用于报销操作`" @change="emit('select-reimbursement', item.inv.id, $event.target.checked)" />报销选择</label>
          <MiddleEllipsis class="min-w-0 font-700" :text="item.inv.name" />
          <span v-if="item.inv.duplicateReason" :class="tagBase" class="text-[#991b1b] bg-[#fef2f2] border-[#fecaca]">重复</span>
          <span v-if="item.inv.history?.entry?.reimbursement === '已报销'" :class="tagBase" class="text-[#991b1b] bg-[#fef2f2] border-[#fecaca]">已报销{{ item.inv.history.entry.reimbursementDate ? ' · ' + item.inv.history.entry.reimbursementDate : ' · 日期未知' }}</span>
          <span v-else-if="item.inv.history?.printed" :class="tagBase" class="text-[#166534] bg-[#f0fdf4] border-[#bbf7d0]">历史已打印</span>
          <span v-else-if="item.inv.history?.verified" :class="tagBase" class="text-[#166534] bg-[#f0fdf4] border-[#bbf7d0]">历史已抵税</span>
          <span v-else-if="item.inv.history?.entry" :class="tagBase" class="text-brand bg-brand-soft border-line">匹配台账</span>
          <span v-else-if="item.inv.history?.needsReview" :class="tagBase" class="text-[#b45309] bg-[#fff7ed] border-[#fed7aa]">台账待核对</span>
          <span v-else-if="item.needsReview" :class="tagBase" class="text-[#b45309] bg-[#fff7ed] border-[#fed7aa]">待复核</span>
        </div>
        <div class="mt-0.75 ml-8.25 text-brand text-[11px]">
          整理后：<MiddleEllipsis :text="invoiceExportFileName(item.inv)" />
        </div>
        <div v-if="groupPath(item.inv).length" class="mt-0.5 ml-8.25 text-ink-soft text-[11px] truncate">📁 {{ groupPath(item.inv).join(" / ") }}</div>
      </div>
      <div class="flex items-center justify-end gap-1.5 flex-wrap">
        <label class="inline-flex items-center gap-1 text-ink-soft text-xs cursor-pointer" @click.stop>
          <CheckboxRoot
            :model-value="item.inv.include"
            @update:model-value="setIncluded(item.inv, $event)"
            class="w-4 h-4 rounded border border-line-strong bg-white grid place-items-center data-[state=checked]:bg-brand data-[state=checked]:border-brand"
          >
            <CheckboxIndicator class="text-white text-[11px] leading-none">✓</CheckboxIndicator>
          </CheckboxRoot>
          打印/汇总
        </label>
        <button class="btn px-2 py-1 text-xs" :disabled="item.inv.rendering || invoiceStore.busy" @click.stop="invoiceActions.recognizeOne(item.inv)">
          {{ item.inv.status === "running" ? "识别中" : "识别" }}
        </button>
        <button v-if="item.inv.rawText" class="btn px-2 py-1 text-xs" @click.stop="showText = !showText">{{ showText ? "收起文本" : "文本" }}</button>
        <button class="btn px-2 py-1 text-xs" title="顺时针旋转 90°（影响预览与打印）" @click.stop="invoiceActions.rotateInvoice(item.inv)">
          ↻ 方向<span v-if="item.inv.rotation" class="text-brand"> {{ item.inv.rotation }}°</span>
        </button>
        <button class="btn-danger px-2 py-1 text-xs" @click.stop="invoiceActions.removeInvoice(item.inv.id)">移除</button>
      </div>
    </div>

    <div class="my-2 flex gap-2.5 flex-wrap text-ink-soft text-xs">
      <span v-if="item.inv.rendering">读取中…</span>
      <span v-else-if="item.inv.status === 'done'" class="text-ok">已识别</span>
      <span v-else-if="item.inv.status === 'error'" class="text-danger">{{ item.inv.error }}</span>
      <span v-else>未识别</span>
      <span v-if="item.inv.systemNote" class="text-[#b45309]">{{ item.inv.systemNote }}</span>
      <span v-if="item.inv.duplicateReason" class="text-[#b45309]">{{ item.inv.duplicateReason }}</span>
      <span v-if="item.inv.history?.usedBefore" class="text-[#b45309]">
        {{ item.inv.history.entry?.reimbursement === '已报销' ? '已报销，请勿重复报销' : '历史台账已记录，' + (item.inv.history.printed ? '已打印' : item.inv.history.verified ? '已抵税' : '有使用记录') }}
      </span>
      <span v-if="item.inv.historyAutoExcluded" class="text-[#b45309]">已按历史记录默认取消勾选，可手动勾选</span>
    </div>

    <div v-if="showText && item.inv.rawText" class="bg-[#f8fafc] border border-line rounded-md p-2 mb-2">
      <pre class="m-0 max-h-37.5 overflow-auto whitespace-pre-wrap text-xs">{{ item.inv.rawText }}</pre>
    </div>

    <div class="grid grid-cols-4 gap-2 max-md:grid-cols-2" @change="invoiceActions.refreshInvoiceMatches">
      <label class="field-label">发票号码<input class="field-input" v-model="item.inv.fields.number" /></label>
      <label class="field-label">开票日期<input class="field-input" v-model="item.inv.fields.date" placeholder="2026-03-09" @input="syncDate(item.inv)" /></label>
      <label class="field-label col-span-2">销售方<input class="field-input" v-model="item.inv.fields.seller" /><SupplierMatch v-model="item.inv.fields.seller" /></label>
      <label class="field-label col-span-2">购买方<SearchSelect v-model="item.inv.fields.buyer" :options="directory.buyers" label="购买方" placeholder="选择已添加的购买方公司" /></label>
      <label class="field-label">金额<input class="field-input" v-model="item.inv.fields.amount" inputmode="decimal" /></label>
      <label class="field-label">税额<input class="field-input" v-model="item.inv.fields.tax" inputmode="decimal" /></label>
      <label class="field-label">价税合计<input class="field-input" v-model="item.inv.fields.total" inputmode="decimal" /></label>
      <label class="field-label">税点<input class="field-input" v-model="item.inv.fields.rate" placeholder="如 13%（混票留空）" /></label>
      <label class="field-label">类型<input class="field-input" v-model="item.inv.fields.type" placeholder="未识别（留空）" /></label>
      <label class="field-label">费用标签<select class="field-input" :value="item.inv.expenseTagSet ? item.inv.expenseTag : item.inv.history?.entry?.expenseTagSet ? item.inv.history.entry.expenseTag : (item.inv.expenseTag || item.inv.history?.entry?.expenseTag || inferExpenseTag(item.inv))" @change.stop="changeTag(item.inv, $event)"><option value="">未分类</option><option v-for="tag in EXPENSE_TAGS" :key="tag" :value="tag">{{ tag }}</option></select></label>
      <label class="field-label col-span-full">票面备注<input class="field-input" v-model="item.inv.fields.remark" placeholder="发票备注栏内容" /></label>
    </div>
  </article>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { store, actions, makeItem } from '../store.js';
import { moneyCents } from '../lib/invoice-allocation.js';
import { formatMoney } from '../lib/format.js';
import FieldsTable from './FieldsTable.vue';
import DeliveryPreview from './DeliveryPreview.vue';
import MiddleEllipsis from './MiddleEllipsis.vue';

const props = defineProps({ file: Object });
const docId = ref(props.file.docs[0]?.id || '');
const doc = computed(() => props.file.docs.find(item => item.id === docId.value) || props.file.docs[0]);
watch(() => props.file.docs.map(item => item.id), ids => { if (!ids.includes(docId.value)) docId.value = ids[0] || ''; });
const amountCheck = computed(() => {
  const filled = (doc.value?.items || []).filter(item =>
    [item.name, item.specification, item.unit, item.quantity, item.unitPrice, item.total].some(value => String(value ?? '').trim()));
  const amounts = filled.map(item => moneyCents(item.total));
  const sum = amounts.reduce((current, value) => current + (value ?? 0), 0);
  const paper = moneyCents(doc.value?.statedTotal);
  const known = amounts.some(value => value !== null);
  if (paper === null) return { sum, known, tone: 'ui-badge-neutral', label: '票面合计待录入' };
  if (!filled.length || amounts.some(value => value === null)) return { sum, known, tone: 'ui-badge-warn', label: '明细金额待补齐' };
  const difference = sum - paper;
  return difference ? { sum, known, tone: 'ui-badge-warn', label: '差额 ¥' + formatMoney(difference / 100) }
    : { sum, known, tone: 'ui-badge-ok', label: '平账' };
});
function setDate(event) {
  const value = event.target.value.trim();
  doc.value.dateText = value;
  const parts = value.match(/^(20\d{2})[-./](\d{1,2})[-./](\d{1,2})$/);
  doc.value.date = parts ? [parts[1], parts[2].padStart(2, '0'), parts[3].padStart(2, '0')].join('-') : null;
}
function addDocument() {
  actions.addDoc(props.file);
  docId.value = props.file.docs.at(-1)?.id;
}
function chooseCandidate(name) {
  if (!doc.value) return;
  const item = doc.value.items.find(row => !row.name);
  if (item) item.name = name;
  else doc.value.items.push({ ...makeItem(), name });
}
</script>

<template>
  <article class="ui-panel delivery-card" aria-label="送货单核对区">
    <div class="delivery-check">
      <DeliveryPreview :file="file" />
      <section class="delivery-heading min-w-0 overflow-auto px-3 py-2.5" aria-label="单据抬头">
        <header class="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
          <h2 class="mr-auto min-w-0 flex-1 text-sm font-semibold"><MiddleEllipsis :text="file.name" /></h2>
          <button class="ui-btn-sm" :disabled="file.rendering || store.ocrBusy" @click="actions.runOcr(file)">{{ file.ocrStatus === 'running' ? '识别中…' : '识别本件' }}</button>
          <button class="ui-btn-ghost h-7 text-xs text-danger" @click="actions.removeFile(file.id)">移除文件</button>
        </header>
        <div class="mb-2 flex flex-wrap items-center gap-1.5">
          <select v-if="file.docs.length > 1" v-model="docId" class="ui-input w-26" aria-label="选择当前单据"><option v-for="(item, index) in file.docs" :key="item.id" :value="item.id">单据 {{ index + 1 }}</option></select>
          <button type="button" class="ui-btn-sm" @click="addDocument">添加单据</button>
          <button v-if="file.docs.length > 1 && doc" type="button" class="ui-btn-ghost h-7 text-xs text-danger" @click="actions.removeDoc(file, doc.id)">删除此单</button>
          <PopoverRoot v-if="file.ocrText">
            <PopoverTrigger class="ui-btn-sm">识别文本</PopoverTrigger>
            <PopoverPortal><PopoverContent class="ui-popover z-45 w-[min(510px,94vw)]" :side-offset="5">
              <div v-if="file.itemCandidates?.length" class="mb-2 flex flex-wrap gap-1"><button v-for="name in file.itemCandidates" :key="name" class="ui-btn-sm" @click="chooseCandidate(name)">{{ name }}</button></div>
              <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-words text-xs">{{ file.ocrText }}</pre>
            </PopoverContent></PopoverPortal>
          </PopoverRoot>
          <span v-if="file.ocrEngine" class="ui-badge-neutral">{{ file.ocrEngine === 'vl' ? 'PaddleOCR-VL' : '本地 OCR' }}</span>
        </div>
        <p v-if="file.companyConflict && file.companyOcr" class="mb-2 flex flex-wrap items-center gap-1.5 rounded bg-warn-soft p-1.5 text-xs text-warn">
          识别供应商：{{ file.companyOcr }} <button type="button" class="ui-btn-sm" @click="actions.adoptOcrCompany(file)">采用识别</button><button type="button" class="ui-btn-sm" @click="actions.dismissCompanyConflict(file)">保留当前</button>
        </p>
        <p v-if="file.ocrError" class="mb-1 text-xs text-danger" role="status">{{ file.ocrError }}</p>
        <div v-if="doc" class="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <label class="ui-label">供应商<input :value="file.company" class="ui-input" placeholder="按红章核对" @input="actions.setCompanyManual(file, $event.target.value)" /></label>
          <label class="ui-label">送货日期<input :value="doc.dateText" class="ui-input ui-money" placeholder="YYYY-MM-DD" @input="setDate" /></label>
          <label class="ui-label">归属工地<select :value="file.partitionId" class="ui-input" @change="actions.moveFile(file.id, $event.target.value)"><option v-for="part in store.partitions" :key="part.id" :value="part.id">{{ part.name }}</option></select></label>
          <label class="ui-label">单据号<input v-model="doc.orderNo" class="ui-input ui-money" /></label>
          <label class="ui-label">票面合计 (元)<input v-model="doc.statedTotal" class="ui-input ui-money" inputmode="decimal" placeholder="核对原图" /></label>
          <div class="ui-label">明细重算合计<div class="flex min-h-8 flex-wrap items-center gap-1.5"><output class="ui-money text-sm font-semibold">{{ amountCheck.known ? '¥' + formatMoney(amountCheck.sum / 100) : '—' }}</output><span :class="amountCheck.tone" role="status">{{ amountCheck.label }}</span></div></div>
          <label class="ui-label col-span-2">备注<input v-model="file.note" class="ui-input" /></label>
          <label class="col-span-2 flex items-center gap-1.5 text-xs"><input v-model="file.merge" type="checkbox" />同工地同公司合并 PDF</label>
        </div>
      </section>
    </div>
    <FieldsTable v-if="doc" :key="doc.id" :doc="doc" />
  </article>
</template>

<style scoped>
.delivery-card { display:grid; grid-template-rows:minmax(320px,44fr) minmax(190px,56fr); height:max(545px,calc(100dvh - 130px)); overflow:hidden; }
.delivery-check { display:grid; grid-template-columns:minmax(0,58fr) minmax(0,42fr); min-height:0; }
.delivery-heading { border-left:1px solid #e3e6ea; }
@media(max-width:850px) {
  .delivery-card { height:auto; grid-template-rows:auto minmax(190px,48vh); }
  .delivery-check { grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(230px,38vh) auto; }
  .delivery-heading { border-left:0; border-top:1px solid #e3e6ea; }
}
</style>

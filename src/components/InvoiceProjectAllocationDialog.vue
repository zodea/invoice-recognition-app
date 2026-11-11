<script setup>
import { computed, ref, shallowRef, watch } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import SearchSelect from './SearchSelect.vue';
import { directory } from '../lib/expense-directory.js';
import { invoiceActions } from '../invoiceStore.js';
import { isMultiProject, moneyCents, projectAllocationState } from '../lib/invoice-allocation.js';
import { toast } from '../lib/toast.js';

const props = defineProps({ entry: { type: Object, required: true } });
const emit = defineEmits(['close']);
const mode = shallowRef('single');
const project = shallowRef('');
const rows = ref([]);
const message = shallowRef('');
const original = shallowRef('');
let seq = 0;
const makeRow = (row = {}) => ({ id: ++seq, project: row.project || '', total: row.total ?? '', remark: row.remark || '' });
const snapshot = entry => JSON.stringify([entry.total, entry.allocation, entry.project, entry.projectAllocations]);
watch(() => props.entry.key, () => {
  mode.value = isMultiProject(props.entry) ? 'multi' : 'single';
  project.value = props.entry.project || '';
  rows.value = isMultiProject(props.entry) ? (props.entry.projectAllocations || []).map(makeRow) : [makeRow({ project: project.value, total: props.entry.total })];
  original.value = snapshot(props.entry);
  message.value = '';
}, { immediate: true });
const state = computed(() => projectAllocationState(props.entry, rows.value));
const options = computed(() => [...new Set([...directory.projects, props.entry.project, ...(props.entry.projectAllocations || []).map(row => row.project)].filter(Boolean))]);
const canSave = computed(() => mode.value === 'single' ? !!project.value : !state.value.errors.length);
const money = value => value == null || value === '' ? '—' : Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function percentage(row) {
  const total = moneyCents(props.entry.total), cents = moneyCents(row.total);
  return total && cents !== null ? `${(cents / total * 100).toFixed(2)}%` : '—';
}
function save() {
  try {
    if (snapshot(props.entry) !== original.value) { message.value = '发票金额或分配已发生变化，请关闭后重新打开核对。'; return; }
    const result = invoiceActions.saveProjectAllocation(props.entry.key, { mode: mode.value, project: project.value, rows: rows.value });
    if (!result.ok) { message.value = result.message; return; }
    toast(mode.value === 'multi' && !state.value.complete ? '已保存，剩余金额待分配' : '工地分配已保存');
    emit('close');
  } catch (error) { message.value = error.message; }
}
</script>

<template>
  <DialogRoot :open="true" @update:open="value => { if (!value) emit('close'); }">
    <DialogPortal>
      <DialogOverlay class="allocation-overlay" />
      <DialogContent class="allocation-dialog" @pointer-down-outside.prevent>
        <header class="allocation-header"><DialogTitle class="allocation-title">工地分配</DialogTitle><button class="btn" @click="emit('close')">关闭</button></header>
        <div class="allocation-body">
          <div class="invoice-context"><span>发票号码 <b>{{ entry.number || '—' }}</b></span><span>价税合计 <b>¥{{ money(entry.total) }}</b></span><span :title="entry.seller">销售方 <b>{{ entry.seller || '—' }}</b></span><span :title="entry.buyer">购买方 <b>{{ entry.buyer || '—' }}</b></span></div>
          <div class="allocation-mode"><span>费用归属</span><label><input v-model="mode" type="radio" value="single" name="project-allocation-mode" />单一工地</label><label><input v-model="mode" type="radio" value="multi" name="project-allocation-mode" />多工地分配</label><small>按含税金额分配</small></div>
          <div v-if="mode === 'single'" class="single-project"><label>使用工地</label><SearchSelect v-model="project" :options="options" label="使用工地" /></div>
          <template v-else>
            <div class="allocation-table-wrap"><table class="allocation-table"><thead><tr><th>使用工地</th><th>分配金额（含税）</th><th>占比</th><th>备注</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>
              <tr v-for="(row, index) in rows" :key="row.id"><td><SearchSelect v-model="row.project" :options="options" :label="`第 ${index + 1} 行工地`" /></td><td><input v-model="row.total" class="field-input allocation-money" inputmode="decimal" :aria-label="`第 ${index + 1} 行分配金额`" placeholder="0.00" /></td><td class="allocation-percent">{{ percentage(row) }}</td><td><input v-model="row.remark" class="field-input" :aria-label="`第 ${index + 1} 行备注`" /></td><td><button class="remove-row" :aria-label="`移除第 ${index + 1} 行`" @click="rows.splice(index, 1)">移除</button></td></tr>
              <tr v-if="!rows.length"><td colspan="5" class="allocation-empty">尚未分配，点击“添加工地”填写。</td></tr>
            </tbody></table></div>
            <div class="allocation-totals"><button class="btn" @click="rows.push(makeRow())">＋ 添加工地</button><span>已分配 <b>{{ money(state.allocated / 100) }}</b></span><span>剩余 <b :class="state.complete ? 'allocation-ok' : 'allocation-pending'">{{ money(state.remaining === null ? null : state.remaining / 100) }}</b></span></div>
            <p v-if="state.errors.length" class="allocation-errors" role="alert">{{ state.errors.join('；') }}</p>
          </template>
          <DialogDescription class="allocation-description">发票保留一张，各工地按分配金额统计。未分完可先保存，剩余金额列为待分配。</DialogDescription>
          <p v-if="message" class="allocation-errors" role="alert">{{ message }}</p>
        </div>
        <footer class="allocation-footer"><span :class="mode === 'single' || state.complete ? 'allocation-ok' : 'allocation-pending'">{{ mode === 'single' ? '整张发票归属一个工地' : state.complete ? '✓ 分配金额与发票一致' : '剩余金额待分配' }}</span><button class="btn" @click="emit('close')">取消</button><button class="btn-primary" :disabled="!canSave" @click="save">保存分配</button></footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.allocation-overlay{position:fixed;inset:0;background:#0f172a40;z-index:85}.allocation-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(710px,94vw);max-height:90vh;display:flex;flex-direction:column;background:#fff;border:1px solid #dfe5ed;border-radius:9px;box-shadow:0 16px 48px #172b4233;z-index:86;outline:none;font-size:12px;color:#1f2329}.allocation-header{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #e3e6ea}.allocation-title{font-size:15px;margin:0;font-weight:700}.allocation-body{padding:18px;overflow:auto;min-height:0}.invoice-context{display:grid;grid-template-columns:1.2fr 1fr;gap:8px 20px;padding:12px;background:#f8fafc;border-radius:6px;color:#64748b}.invoice-context span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.invoice-context b{color:#1f2329;font-weight:500;margin-left:8px}.invoice-context span:nth-child(2) b{font-weight:700}.allocation-mode{display:flex;align-items:center;gap:18px;margin:18px 0 14px}.allocation-mode label{display:flex;align-items:center;gap:5px;white-space:nowrap}.allocation-mode input{accent-color:#1867c0}.allocation-mode small{margin-left:auto;color:#64748b;font-size:11px}.single-project{display:flex;align-items:center;gap:18px;margin-bottom:22px}.single-project :deep(.search-select){max-width:300px}.allocation-table-wrap{overflow:visible;min-height:70px}.allocation-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e3e6ea;border-radius:6px;table-layout:fixed}.allocation-table th{font-weight:600;background:#f8fafc;color:#5b6470;text-align:left;padding:8px}.allocation-table th:nth-child(1){width:27%}.allocation-table th:nth-child(2){width:23%}.allocation-table th:nth-child(3){width:12%}.allocation-table th:nth-child(4){width:29%}.allocation-table th:nth-child(5){width:9%}.allocation-table td{padding:6px;border-top:1px solid #edf1f5;vertical-align:middle}.allocation-table .field-input{width:100%;height:30px;padding:4px 7px;font-size:12px;border-radius:4px}.allocation-money{text-align:right;font-variant-numeric:tabular-nums}.allocation-percent{color:#64748b;font-variant-numeric:tabular-nums;font-size:11px}.remove-row{border:0;background:none;color:#b91c1c;padding:4px 0;font-size:12px;white-space:nowrap}.allocation-totals{display:flex;align-items:center;gap:16px;margin-top:10px;color:#64748b}.allocation-totals .btn{margin-right:auto}.allocation-totals b{margin-left:5px;color:#1f2329;font-variant-numeric:tabular-nums}.allocation-totals .allocation-ok,.allocation-ok{color:#16803b}.allocation-totals .allocation-pending,.allocation-pending{color:#a15c08}.allocation-description{font-size:11px;color:#64748b;line-height:1.6;margin:10px 0 0}.allocation-errors{font-size:12px;line-height:1.6;color:#b91c1c;margin:8px 0 0}.allocation-footer{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid #e3e6ea}.allocation-footer>span{margin-right:auto;font-size:11px}.allocation-dialog .btn,.allocation-dialog .btn-primary{min-height:30px;padding:4px 10px;font-size:12px}.allocation-dialog :deep(.search-select input){height:30px;padding:4px 28px 4px 7px!important;border-radius:4px}.allocation-dialog :deep(.select-clear),.allocation-dialog :deep(.select-chevron){top:4px}.allocation-empty{padding:18px!important;text-align:center;color:#64748b}@media(max-width:600px){.invoice-context{grid-template-columns:1fr}.allocation-mode{gap:8px;flex-wrap:wrap}.allocation-mode small{margin-left:0}.allocation-table th:nth-child(4),.allocation-table td:nth-child(4){display:none}.allocation-table th:nth-child(1){width:37%}.allocation-table th:nth-child(2){width:30%}.allocation-table th:nth-child(3){width:20%}.allocation-table th:nth-child(5){width:13%}}
</style>

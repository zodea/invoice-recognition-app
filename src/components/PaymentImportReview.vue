<script setup>
import { computed, ref, shallowRef } from 'vue';
import AppIcon from './AppIcon.vue';
import { parsePaymentWorkbook } from '../lib/payment-records.js';
import { reviewPaymentImport } from '../lib/payment-reconciliation.js';
import { formatMoney } from '../lib/format.js';

const props = defineProps({ existingRows: { type: Array, required: true }, period: { type: String, default: '' } });
const emit = defineEmits(['commit', 'evidence', 'error']);
const records = ref([]), evidence = shallowRef([]), busy = shallowRef(false), loaded = shallowRef(false);
const reviewed = computed(() => reviewPaymentImport(records.value, props.existingRows, evidence.value, props.period));
const importable = computed(() => reviewed.value.filter(row => row.canImport));
const issues = computed(() => reviewed.value.filter(row => !row.canImport));
async function prepare(event) {
  const files = Array.from(event.target.files || []); event.target.value = '';
  busy.value = true;
  try {
    const next = [];
    for (const file of files.filter(file => /\.xlsx?$/i.test(file.name) && !file.name.startsWith('~$'))) {
      next.push(...parsePaymentWorkbook(await file.arrayBuffer(), file.webkitRelativePath || file.name, { includeInvalid: true }));
    }
    records.value = next;
    evidence.value = files.filter(file => /\.(pdf|png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name));
    emit('evidence', evidence.value);
    loaded.value = true;
  } catch (error) { emit('error', error.message); }
  finally { busy.value = false; }
}
function commit() {
  const next = importable.value.map(row => row.record);
  if (next.length) emit('commit', next);
}
</script>

<template>
  <section class="payment-import-review" aria-labelledby="payment-review-title">
    <div class="finance-toolbar">
      <div><h2 id="payment-review-title">付款清单核对</h2><p class="field-hint">先预览款项、重复和凭证候选，保存后逐笔对照原件。</p></div>
      <div class="toolbar-actions">
        <label class="btn-primary file-button"><AppIcon name="upload" :size="17" />{{ busy ? '正在读取…' : '选择清单 / 凭证' }}<input type="file" multiple accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff" :disabled="busy" @change="prepare" /></label>
        <label class="btn file-button"><AppIcon name="folder" :size="17" />选择文件夹<input type="file" webkitdirectory multiple :disabled="busy" @change="prepare" /></label>
      </div>
    </div>
    <template v-if="loaded">
      <div class="finance-filterbar"><span class="status-pill success">可新增 {{ importable.length }}</span><span class="status-pill warning">重复 / 冲突 / 不完整 {{ issues.length }}</span><span class="table-count">{{ evidence.length }} 份凭证 · {{ reviewed.length }} 笔清单款项</span></div>
      <div class="finance-table-wrap">
        <table class="finance-table"><thead><tr><th>核对结果</th><th>下单日期</th><th>付款名称</th><th>收款名称</th><th>实付合计</th><th>材料或费用</th><th>使用项目</th><th>凭证候选</th><th>问题说明</th><th>原始来源</th></tr></thead>
          <tbody><tr v-for="(item, index) in reviewed" :key="item.record.id + '|' + index"><td><span class="status-pill" :class="item.canImport ? 'neutral' : 'warning'">{{ item.status }}</span></td><td>{{ item.record.date || '待补充' }}</td><td>{{ item.record.payer || '待确认' }}</td><td>{{ item.record.seller || '待补充' }}</td><td class="number-cell">{{ formatMoney(item.record.total) }}</td><td>{{ item.record.purpose }}</td><td>{{ item.record.project || '待确认或独立费用' }}</td><td>{{ item.candidates.length }} 份<small v-for="candidate in item.candidates" :key="candidate.file.webkitRelativePath || candidate.file.name">{{ candidate.file.webkitRelativePath || candidate.file.name }}<br />{{ candidate.hint }}</small></td><td><div v-for="issue in item.issues" :key="issue">{{ issue }}</div></td><td>{{ item.record.source }}</td></tr>
            <tr v-if="!reviewed.length"><td colspan="10">未读取到支持的付款清单。请选择含“下单日期、收款名称”或“日期、名字、金额”的 Excel；已选原件可在下方付款记录中匹配。</td></tr></tbody>
        </table>
      </div>
      <div class="finance-dialog-footer"><span class="field-hint">新增记录保持未核对；已有报销和付款状态保留。</span><button class="btn-primary" :disabled="busy || !importable.length" @click="commit">保存 {{ importable.length }} 笔待核对款项</button></div>
    </template>
  </section>
</template>

<style scoped>
.payment-import-review { border-bottom: 1px solid var(--line, #dce3eb); padding-bottom: 1rem; margin-bottom: 1rem; }
.payment-import-review h2 { margin: 0 0 .25rem; font-size: 1rem; }
.payment-import-review small { display: block; max-width: 24rem; overflow-wrap: anywhere; margin-top: .4rem; }
</style>

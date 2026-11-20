<script setup>
import FileDropInput from './FileDropInput.vue';
import { computed, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import PaymentEvidencePicker from './PaymentEvidencePicker.vue';
import {usePaymentBatch} from '../composables/usePaymentBatch.js';
import PaymentRecognitionQueue from './PaymentRecognitionQueue.vue';
import { formatMoney } from '../lib/format.js';
import { paymentRange } from '../lib/payment-transactions.js';

const props=defineProps({existingRows:Array,period:String,saving:Boolean});
const emit=defineEmits(['commit','evidence','error']);
const {queue,records,evidence,recognitionIssues,busy,loaded,progress,selections,excluded,confirmed,manualTarget,reviewed,importable,plan,selectedFor,reset:clearBatch,prepare,commit}=usePaymentBatch(props,emit);
defineExpose({prepare});
const editing=ref(''),batchStatus=ref('沿用清单');
const issues=computed(()=>reviewed.value.filter(i=>!i.canImport));
function reset(){clearBatch();editing.value='';batchStatus.value='沿用清单';}
function invalidate(id){ confirmed.value=confirmed.value.filter(v=>v!==id); }
function toggleInclude(id,yes){ excluded.value=yes?excluded.value.filter(v=>v!==id):[...excluded.value,id]; }
function toggleConfirmed(id,yes){ invalidate(id); if(yes) confirmed.value.push(id); }
function updatePurpose(r){r.purpose=r.lines.map(l=>l.purpose).filter(Boolean).join(' / ');invalidate(r.id);}
function updateLines(r){
  updatePurpose(r);
  const nums=r.lines.map(l=>l.lineAmount);
  r.lineTotal=nums.length && nums.every(v=>v!=='' && Number.isFinite(Number(v))) ? nums.reduce((sum,v)=>sum+Math.round(Number(v)*100),0)/100:'';
  if (r.explicitTotal==='' && !r.manualTotal) r.total=r.lineTotal;
  r.importWarnings=r.importWarnings.filter(w=>!w.startsWith('按 ')&&!w.startsWith('调整后'));
  if (r.lineTotal!=='' && Number(r.total)!==r.lineTotal) r.importWarnings.push('调整后的明细合计与实付金额不一致');
  else if (r.lineTotal!=='' && r.explicitTotal==='' && !r.manualTotal) r.importWarnings.push('按调整后明细合计 '+r.lineTotal+' 元');
  if (r.lineTotal==='' && nums.length) r.importWarnings.push('调整后部分明细金额为空或无效');
}
function removeLine(r,i){r.lines.splice(i,1);updateLines(r);}
function addLine(r){r.lines.push({purpose:'',unit:'',quantity:'',unitPrice:'',lineAmount:''});updateLines(r);}
</script>

<template>
  <section class="payment-import-review" aria-labelledby="payment-review-title">
    <div class="finance-toolbar">
      <div><h2 id="payment-review-title">付款清单核对</h2><p class="field-hint">选择整个批次文件夹可同时读取 Excel 和链接的附件。核对分配结果后统一保存。</p></div>
      <div class="toolbar-actions">
        <FileDropInput label="选择清单 / 凭证" accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff" multiple folders :disabled="busy||saving" @files="prepare" />
      </div>
    </div>
    <slot />
    <button v-if="loaded" type="button" class="text-action" :disabled="busy||saving" @click="reset">清空本次预览</button><p v-if="progress" class="field-hint" role="status">{{ progress }}</p><template v-if="loaded">
      <PaymentRecognitionQueue v-if="queue.length" :queue="queue"/>
      <label v-if="evidence.length&&existingRows.length" class="existing-target">补充到已有付款<select v-model="manualTarget"><option value="">选择需要人工分配的记录</option><option v-for="r in existingRows.filter(r=>!r.linkedLedgerKey&&!r.duplicateOf&&!r.supplementOnly)" :key="r.id" :value="r.id">{{ r.date }} · {{ r.seller }} · {{ r.total }} 元 · {{ r.source }}</option></select></label>
      <details v-if="recognitionIssues.length"><summary>{{ recognitionIssues.length }} 条凭证识别提示</summary><div v-for="(issue, i) in recognitionIssues" :key="i">{{ issue }}</div></details>
      <div class="finance-filterbar"><span class="status-pill success">本次保存 {{ importable.length }}</span><span class="status-pill warning">待处理 {{ issues.length }}</span><span class="table-count">{{ evidence.length }} 份凭证 · {{ records.length }} 笔清单款项</span></div>
      <div class="finance-table-wrap">
        <table class="finance-table"><thead><tr><th>导入</th><th>核对结果</th><th>类型 / 日期范围</th><th>付款日期</th><th>付款名称</th><th>收款名称</th><th>实付合计</th><th>材料或费用</th><th>使用项目</th><th>凭证候选</th><th>问题说明</th><th>原始来源</th></tr></thead>
          <tbody v-for="(item, index) in reviewed" :key="item.record.id + '|' + index">
            <tr><td><input type="checkbox" :disabled="!item.canImport" :checked="item.canImport && !excluded.includes(item.record.id)" :aria-label="'导入 ' + item.record.source" @change="toggleInclude(item.record.id, $event.target.checked)" /></td><td><span class="status-pill" :class="item.canImport ? 'neutral' : 'warning'">{{ item.status }}</span><br /><button v-if="!item.existing" class="text-action" @click="editing = editing === item.record.id ? '' : item.record.id">{{ editing === item.record.id ? '收起' : '调整' }}</button></td><td>{{ item.record.recordType || '普通费用' }}<br />{{ item.record.recordType === '阶段汇总' ? paymentRange(item.record.dateRange).label : item.record.dateRange }}</td><td>{{ item.record.date || '未知' }}</td><td>{{ item.record.payer || '待确认' }}</td><td>{{ item.record.seller || '待补充' }}</td><td class="number-cell">{{ formatMoney(item.record.total) }}</td><td>{{ item.record.purpose }}<small v-for="(line, i) in item.record.lines" :key="i">{{ line.purpose }} · {{ line.quantity }} {{ line.unit }} × {{ line.unitPrice }} · {{ line.lineAmount }} 元</small></td><td>{{ item.record.project || '待确认或独立费用' }}</td><td><PaymentEvidencePicker :item="item" :files="evidence" :model-value="selectedFor(item.record.id)" @update:model-value="selections[item.record.id] = $event" /></td><td><div v-for="issue in [...new Set([...item.issues,...(item.record.sourceIssues||[]),...(plan.get(item.record.id)?.notes||[])])]" :key="issue">{{ issue }}</div></td><td>{{ item.record.source }}</td></tr>
            <tr v-if="!item.existing && editing === item.record.id"><td colspan="12"><div class="review-editor"><p>可调整本次导入或取消勾选。由明细计算的金额随明细更新，原表实付金额保留供核对。</p><div class="review-grid">
              <label>记录类型<select v-model="records[index].recordType" @change="if (records[index].recordType !== '阶段汇总') records[index].cashWithoutEvidence = false; invalidate(item.record.id)"><option value="">普通费用</option><option>合计</option><option>阶段汇总</option><option>现金无凭证</option></select></label>
              <label>日期范围<input v-model="records[index].dateRange" placeholder="已知部分可填写" @input="invalidate(item.record.id)" /></label>
              <label v-if="records[index].recordType === '阶段汇总'" class="inline-check"><input type="checkbox" v-model="records[index].cashWithoutEvidence" @change="invalidate(item.record.id)" />现金支付且无凭证</label>
              <label>付款日期<input v-model="records[index].date" type="date" @input="invalidate(item.record.id)" /></label>
              <label>付款人<input v-model="records[index].payer" @input="invalidate(item.record.id)" /></label>
              <label>收款人<input v-model="records[index].seller" @input="invalidate(item.record.id)" /></label>
              <label>实付金额<input v-model="records[index].total" type="number" step="0.01" @input="records[index].manualTotal=true; invalidate(item.record.id)" /></label>
              <label>项目<input v-model="records[index].project" @input="invalidate(item.record.id)" /></label>
              <label>备注<input v-model="records[index].note" @input="invalidate(item.record.id)" /></label>
            </div><div v-for="(line, lineIndex) in records[index].lines" :key="lineIndex" class="review-line"><input v-model="line.purpose" aria-label="明细名称" placeholder="名称" @input="updatePurpose(records[index])" /><input v-model="line.quantity" aria-label="数量" placeholder="数量" @input="invalidate(item.record.id)" /><input v-model="line.unit" aria-label="单位" placeholder="单位" @input="invalidate(item.record.id)" /><input v-model="line.unitPrice" aria-label="单价" placeholder="单价" @input="invalidate(item.record.id)" /><input v-model="line.lineAmount" aria-label="明细金额" placeholder="明细金额" @input="updateLines(records[index])" /><button class="btn" @click="removeLine(records[index], lineIndex)">删除明细</button></div><button class="btn" @click="addLine(records[index])">添加明细</button>
              <details v-if="item.record.rawRows"><summary>查看 Excel 原始行</summary><pre>{{ JSON.stringify(item.record.rawRows, null, 2) }}</pre></details>
              <label v-if="item.status === '需人工核对' || item.status === '疑似重复' || item.status === '已人工核对' || (item.status === '信息不完整' && item.record.recordType === '阶段汇总' && !item.record.seller)" class="inline-check"><input type="checkbox" :checked="confirmed.includes(item.record.id)" @change="toggleConfirmed(item.record.id, $event.target.checked)" />我已对照原始行及可能重复的记录，确认分组和金额；若存在疑似重复，确认这是一笔不同的交易，同意导入。</label>
              <p v-if="item.status === '需人工核对'" class="field-hint">若实际属于多笔付款，请先在 Excel 调整后重新导入，不要确认成一笔。</p>
            </div></td></tr>
          </tbody><tbody v-if="!reviewed.length"><tr><td colspan="12">未读取到支持的付款清单。请选择含日期或记录类型、收款人及金额的 Excel。</td></tr></tbody>
        </table>
      </div>
      <div class="finance-dialog-footer"><label>本次新增报销状态 <select v-model="batchStatus"><option>沿用清单</option><option>未核对</option><option>未报销</option><option>已报销</option></select></label><span class="field-hint">只应用于本次新增记录；已有付款和报销状态不会覆盖。{{ batchStatus === '已报销' ? '请选择此项前确认本次记录均已报销。' : '' }}</span><button class="btn-primary" :disabled="busy || !importable.length || saving" @click="commit(batchStatus)">保存 {{ importable.length }} 笔</button></div>
    </template>
  </section>
</template>

<style scoped>
.payment-import-review { border-bottom: 1px solid var(--line, #dce3eb); padding-bottom: 1rem; margin-bottom: 1rem; }
.payment-import-review h2 { margin: 0 0 .25rem; font-size: 1rem; }
.payment-import-review small { display: block; max-width: 24rem; overflow-wrap: anywhere; margin-top: .4rem; }
.review-editor { padding: 1rem; white-space: normal; }
.review-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .6rem; }
.review-grid label { display: grid; gap: .25rem; }
.review-line { display: flex; flex-wrap: wrap; gap: .4rem; margin: .6rem 0; }
.review-line input { width: 8rem; }
.review-editor pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.existing-target{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 20px}.existing-target select{max-width:100%}.payment-import-review .finance-table-wrap{max-height:52vh}.payment-import-review .finance-table td{white-space:normal;overflow-wrap:anywhere}.payment-import-review .finance-table td:nth-child(8){min-width:12rem}.payment-import-review>details,.payment-import-review>.text-action,.payment-import-review>p{margin-inline:20px}
</style>

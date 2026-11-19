<script setup>
import { computed, ref, onBeforeUnmount } from 'vue';
import { suggestedEvidenceKind } from '../lib/payment-attachments.js';
import { reconcileEvidenceTransactions } from '../lib/payment-transactions.js';
import { isPdf } from '../lib/file-utils.js';
const props=defineProps({item:Object, files:Array, modelValue:Array});
const emit=defineEmits(['update:modelValue']);
const showAll=ref(false), preview=ref(null);
const choices=computed(()=>{
  const hints=new Map(props.item.candidates.map(c=>[c.file.file,c.hint]));
  return props.files.map((c,index)=>({c,index,hint:hints.get(c.file),choice:props.modelValue.find(s=>s.index===index)}))
    .filter(x=>showAll.value || x.hint || x.choice);
});
const stage=computed(()=>props.item.record.recordType==='阶段汇总');
function transactions(c) { return c.transactions?.length ? c.transactions.map(t=>t.fields||t) : [c.fields||{}]; }
const result=computed(()=>reconcileEvidenceTransactions(props.modelValue.filter(s=>s.kind==='付款凭证').flatMap(s=>
  transactions(props.files[s.index]).filter((_,i)=>!s.omit.includes(i))),props.item.record.total,props.item.record.dateRange));
function setChoice(index, value) {
  const next=props.modelValue.filter(s=>s.index!==index);
  if(value) next.push(value);
  emit('update:modelValue',next);
}
function check(index,c,yes) { setChoice(index,yes?{index,kind:suggestedEvidenceKind(c),omit:[]}:null); }
function countTransaction(choice,i,yes) {
  setChoice(choice.index,{...choice,omit:yes?choice.omit.filter(v=>v!==i):[...choice.omit,i]});
}
function close(){if(preview.value) URL.revokeObjectURL(preview.value.url);preview.value=null;}
function open(file){close();preview.value={url:URL.createObjectURL(file),pdf:isPdf(file),name:file.name};}
onBeforeUnmount(close);
</script>
<template>
  <div v-if="files.length" class="evidence-picker">
    <details><summary>{{ item.candidates.length }} 份候选 · 已选 {{ modelValue.length }} 份</summary>
      <label><input v-model="showAll" type="checkbox" />列出全部已读文件</label>
      <div v-for="{c,index,hint,choice} in choices" :key="index" class="choice">
        <label><input type="checkbox" :checked="!!choice" @change="check(index,c,$event.target.checked)" />{{ c.file.webkitRelativePath || c.file.name }}</label>
        <button type="button" class="text-action" @click="open(c.file)">查看原件</button>
        <small>{{ hint || '手动选择' }} · {{ c.fields?.date || '日期未知' }} · {{ c.fields?.seller || '收款方未知' }} · {{ c.fields?.total === '' || c.fields?.total == null ? '实付未知' : c.fields.total+' 元' }}</small>
        <small v-if="c.fields?.transactionId || c.fields?.orderId">交易号 {{ c.fields.transactionId || '未知' }} · 订单号 {{ c.fields.orderId || '未知' }}</small>
        <small v-if="c.duplicateHint">{{ c.duplicateHint }}</small>
        <label v-if="choice">保存为
          <select :value="choice.kind" :disabled="c.fields?.kind==='order'" @change="setChoice(index,{...choice,kind:$event.target.value})">
            <option>付款凭证</option><option>订单详情</option><option>其他附件</option>
          </select>
        </label>
        <template v-if="stage && choice?.kind==='付款凭证'">
          <label v-for="(t,i) in transactions(c)" :key="i"><input type="checkbox" :checked="!choice.omit.includes(i)" @change="countTransaction(choice,i,$event.target.checked)" />
            计入核对 · {{ t.date || '日期未知' }} · {{ t.total === '' || t.total == null ? '金额未知' : t.total+' 元' }} · {{ t.transactionId || t.orderId || '单号未知' }} · {{ ({success:'成功',failed:'失败或退款',pending:'待支付'})[t.paymentStatus] || '状态未知' }}
          </label>
        </template>
      </div>
    </details>
    <small v-if="stage && modelValue.length">可核实 {{ result.unique.length }} 笔，合计 {{ result.total }} 元；重叠 {{ result.duplicates.length }} 条，待核 {{ result.unresolved.length }} 条。{{ result.matches ? '与清单相符' : '尚未核平' }}</small>
    <Teleport to="body"><div v-if="preview" class="original-overlay" role="dialog" aria-modal="true" aria-label="凭证预览">
      <div><header>{{ preview.name }} <button class="btn" @click="close">关闭原件</button></header>
      <iframe v-if="preview.pdf" :src="preview.url" title="PDF 原件"></iframe><img v-else :src="preview.url" alt="所选凭证原件" /></div>
    </div></Teleport>
  </div><span v-else>—</span>
</template>
<style scoped>
.choice { margin:.5rem 0; border-top:1px solid var(--line); padding:.4rem 0; }
.evidence-picker { min-width:13rem; max-width:25rem; white-space:normal; }
.choice label,.choice small { display:block; overflow-wrap:anywhere; }
.original-overlay { position:fixed; inset:0; z-index:1200; background:#172435bb; display:grid; place-items:center; }
.original-overlay>div { background:white; width:min(90vw,900px); max-height:92vh; overflow:auto; padding:1rem; }
.original-overlay header { display:flex; justify-content:space-between; align-items:center; }
.original-overlay img { max-width:100%; display:block; margin:auto; }
.original-overlay iframe { width:100%; height:76vh; border:0; }
</style>

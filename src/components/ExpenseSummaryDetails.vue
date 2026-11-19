<script setup>
import { computed, ref } from 'vue';
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import { directory } from '../lib/expense-directory.js';
import { invoiceActions } from '../invoiceStore.js';
import { allocationKind } from '../lib/payment-records.js';
import { isMultiProject } from '../lib/invoice-allocation.js';
import InvoiceProjectAllocationDialog from './InvoiceProjectAllocationDialog.vue';
import { toast } from '../lib/toast.js';

const props=defineProps({ sources:Array, group:Object });
const emit=defineEmits(['close']);
const selected=ref(null), allocation=ref(''), project=ref(''), message=ref(''), query=ref(''), page=ref(1), split=ref(null);
const filtered=computed(()=>props.sources.filter(({entry,key})=>[key,entry.date,entry.number,entry.seller,entry.total].some(v=>String(v??'').includes(query.value.trim()))));
const pages=computed(()=>Math.max(1,Math.ceil(filtered.value.length/30)));
const choices=computed(()=>[...new Set(['指定工地','公司开支','个人报账','加油','待确认',...directory.allocations,allocation.value].filter(Boolean))]);
function edit(row){
  selected.value={...row,fingerprint:JSON.stringify(row.entry)};
  allocation.value=allocationKind(row.entry);project.value=row.entry.project||'';message.value='';
}
function save(){
  const row=selected.value;
  if(!row)return;
  if(allocation.value==='指定工地'&&!project.value){message.value='请选择工地';return;}
  try{
    const change={ id:row.key,kind:row.kind,targetKey:row.key,fingerprint:row.fingerprint,canApply:true,patch:{allocation:allocation.value,project:project.value} };
    invoiceActions.applyAssignmentImport([change],[change.id]);
    toast('已保存该笔记录的工地和费用归属');emit('close');
  }catch(error){message.value=error.message;}
}
</script>
<template>
  <DialogRoot v-if="!split" :open="true" @update:open="v=>!v&&emit('close')"><DialogPortal><DialogOverlay class="file-import-overlay" />
    <DialogContent class="file-import-dialog summary-detail-dialog">
      <header><DialogTitle>调整费用明细</DialogTitle><DialogClose class="btn">关闭</DialogClose></header>
      <DialogDescription>{{ [group.buyer,group.project,group.allocation].filter(Boolean).join(' · ') }}。选择需要调整的原始记录，保存后重新汇总。</DialogDescription>
      <input v-model="query" class="field-input" placeholder="搜索票号、日期、厂家或金额" aria-label="搜索费用明细" @input="page=1" />
      <div class="summary-items"><div v-for="row in filtered.slice((page-1)*30,page*30)" :key="row.kind+row.key">
        <span>{{ row.kind==='invoice'?'发票':'付款' }} · {{ row.entry.date || '无日期' }} · {{ row.entry.seller || '无厂家' }} · {{ row.entry.total }} 元<br><small>{{ row.entry.number || row.key }}</small></span>
        <button v-if="isMultiProject(row.entry) && row.kind==='invoice'" class="btn" @click="split={...row.entry,key:row.key}">调整分摊</button>
        <button v-else-if="!isMultiProject(row.entry)" class="btn" @click="edit(row)">调整归属</button><span v-else>多工地分摊</span>
      </div></div>
      <div class="summary-pager"><button class="btn" :disabled="page<=1" @click="page--">上一页</button>{{ page }} / {{ pages }} · {{ filtered.length }} 笔<button class="btn" :disabled="page>=pages" @click="page++">下一页</button></div>
      <div v-if="selected" class="summary-editor"><strong>{{ selected.entry.number || selected.entry.seller }} · {{ selected.entry.total }} 元</strong>
        <label>费用归属<select v-model="allocation"><option v-for="v in choices" :key="v">{{ v }}</option></select></label>
        <label>工地<select v-model="project"><option value="">未指定工地</option><option v-for="v in directory.projects" :key="v">{{ v }}</option></select></label>
        <p v-if="message" role="alert">{{ message }}</p><button class="btn-primary" @click="save">保存这笔归属</button>
      </div>
    </DialogContent></DialogPortal></DialogRoot>
  <InvoiceProjectAllocationDialog v-if="split" :entry="split" @close="emit('close')" />
</template>
<style scoped>
.summary-detail-dialog { width:min(700px,94vw); font-size:13px; }
.summary-items { overflow:auto; max-height:40dvh; }
.summary-items>div,.summary-pager { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px; }
.summary-items>div { border-bottom:1px solid #e2e8ef; }.summary-items span { overflow-wrap:anywhere; }
.summary-items button { flex:none; }.summary-items small { color:#64748b; }
.summary-editor { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.summary-editor strong,.summary-editor button,.summary-editor p { grid-column:1/-1; }
.summary-editor label { display:grid; gap:4px; }.summary-editor select { min-width:0; }
</style>

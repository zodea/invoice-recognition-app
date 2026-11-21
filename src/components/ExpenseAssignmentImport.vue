<script setup>
import UiDisclosure from './UiDisclosure.vue';
import FileDropInput from './FileDropInput.vue';
import { computed, ref, shallowRef } from 'vue';
import {DialogRoot,DialogPortal,DialogOverlay,DialogContent,DialogTitle,DialogDescription} from 'reka-ui';
import {invoiceStore,invoiceActions} from '../invoiceStore.js';
import {paymentStore} from '../lib/payment-store.js';
import {directory} from '../lib/expense-directory.js';
import {parseAssignmentWorkbook,reviewAssignmentImport,buildAssignmentTemplate} from '../lib/expense-assignment-import.js';
import {downloadBytes} from '../lib/file-utils.js';
defineProps({label:{type:String,default:'批量导入归属'}, compact: Boolean});
const opened=ref(false), loading=ref(false), source=shallowRef(null), selected=ref([]), message=ref('');
const mappings=ref({}), newNames=ref([]), review=shallowRef([]);
const groups=computed(()=>[...new Set((source.value?.invoices||[]).filter(r=>r.fromInvoiceList).map(r=>r.project))]);
const newProjects=computed(()=>groups.value.filter(name=>name && newNames.value.includes(name) && !mappings.value[name] && !directory.projects.includes(name)));
const usable=computed(()=>review.value.filter(i=>i.canApply));
async function load(files){
 if(loading.value || !files.length)return;
 loading.value=true;source.value=null;review.value=[];selected.value=[];mappings.value={};newNames.value=[];message.value='';
 try {
  const batch={invoices:[],payments:[],allocations:[]};
  for(const [i,file] of files.entries()){
   const data=parseAssignmentWorkbook(await file.arrayBuffer(),file.name);
   if(files.length>1 && data.allocations.length)throw Error('含多工地分摊的专用模板请单独导入');
   for(const kind of ['invoices','payments'])batch[kind].push(...data[kind].map(row=>({...row,id:i+'|'+row.id,sourceFile:row.sourceFile||file.name})));
   batch.allocations.push(...data.allocations);
  }
  source.value=batch;preview();
 }catch(error){message.value=error.message;}finally{loading.value=false;}
}
function preview(){
 if(!source.value)return;
 const data={...source.value,invoices:source.value.invoices.map(row=>row.fromInvoiceList?{...row,project:mappings.value[row.project]||row.project}:row)};
 review.value=reviewAssignmentImport(data,invoiceStore.ledger,paymentStore.rows,{...directory,projects:[...directory.projects,...newProjects.value]});
 selected.value=usable.value.map(i=>i.id);message.value='';
}
function apply(){
 try{
  const result=invoiceActions.applyAssignmentImport(review.value,selected.value,newProjects.value);
  preview();message.value='已更新 '+result.invoicesUpdated+' 张发票、'+result.paymentsUpdated+' 笔付款的归属。';
 }catch(error){message.value=error.message;}
}
function template(){downloadBytes(buildAssignmentTemplate(directory),'归属导入模板.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}
</script>
<template>
 <button type="button" :class="compact ? 'ui-btn' : 'btn'" @click="opened=true">{{ label }}</button>
 <DialogRoot v-model:open="opened"><DialogPortal><DialogOverlay class="assignment-overlay"/>
  <DialogContent class="assignment-dialog">
   <header><DialogTitle>按清单批量分配工地</DialogTitle><button class="btn" @click="opened=false">关闭</button></header>
   <DialogDescription>选择原发票清单，按票号、日期和金额核对已保存发票。工地简称可一次对应整批。付款归属及多工地分摊也可使用专用模板。</DialogDescription>
   <div class="assignment-tools">
    <FileDropInput label="选择发票清单 / 归属表" multiple :disabled="loading" @files="load" />
    <button class="btn" @click="template">下载空白模板</button><button v-if="source" class="btn" @click="preview">重新预览</button>
   </div>
   <div class="assignment-body">
    <UiDisclosure v-if="groups.length" default-open><template #label>清单工地对应 · {{ groups.length }} 项</template><div class="mapping-grid">
     <div v-for="name in groups" :key="name" class="mapping-field"><label>{{ name||'未填写工地的行' }}
      <select v-model="mappings[name]" @change="preview"><option :value="undefined">{{ directory.projects.includes(name)?'按原名匹配':'选择档案工地' }}</option><option v-for="p in directory.projects" :key="p">{{ p }}</option></select>
     </label><label v-if="name&&!directory.projects.includes(name)&&!mappings[name]" class="inline-check"><input v-model="newNames" :value="name" type="checkbox" @change="preview">按此名称新建工地</label></div>
    </div></UiDisclosure>
    <div v-if="review.length" class="assignment-table"><table class="finance-table"><thead><tr><th><input type="checkbox" aria-label="选择全部可更新行" :checked="!!usable.length&&selected.length===usable.length" @change="selected=$event.target.checked?usable.map(i=>i.id):[]"></th><th>核对结果</th><th>发票 / 付款</th><th>日期 / 金额</th><th>原工地 → 新归属</th><th>清单来源</th><th>问题说明</th></tr></thead><tbody><tr v-for="item in review" :key="item.id" :class="{ 'bg-warn-soft text-warn': !item.canApply }">
     <td><input v-model="selected" type="checkbox" :value="item.id" :disabled="!item.canApply" :aria-label="'选择归属行 '+item.id"/></td><td>{{ item.status }}</td><td>{{ item.kind==='invoice'?item.row.number:item.row.seller }}</td><td>{{ item.row.date }}<br>{{ item.row.total }} 元</td><td>{{ item.previous?.project||item.previous?.allocation||'—' }} → {{ item.patch?.project||item.patch?.allocation||item.row.project||'待确认' }}</td><td>{{ [item.row.sourceFile,item.row.sourceSheet,item.row.sourceRow].filter(Boolean).join(' / ') }}</td><td>{{ item.issues.join('；') }}</td>
    </tr></tbody></table></div>
   </div>
   <p v-if="message" role="status">{{ message }}</p><footer><span>可更新 {{ usable.length }} 条 / 共 {{ review.length }} 条</span><button class="btn-primary" :disabled="!selected.length||invoiceStore.savingIntake||loading" @click="apply">确认更新所选 {{ selected.length }} 条归属</button></footer>
  </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.assignment-overlay{position:fixed;inset:0;background:#15283c70;z-index:80}
.assignment-dialog{position:fixed;inset:0;margin:auto;width:min(94vw,1220px);height:fit-content;max-height:92dvh;box-sizing:border-box;z-index:81;display:flex;flex-direction:column;gap:12px;padding:22px;background:white;border-radius:12px;box-shadow:0 18px 60px #17304936}
.assignment-dialog header,.assignment-tools,.assignment-dialog footer{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.assignment-dialog h2,.assignment-dialog p{margin:0}.assignment-dialog p,.assignment-dialog footer{font-size:13px;color:#51647b}.assignment-tools{justify-content:flex-start}
.assignment-body,.assignment-table{overflow:auto;min-height:0}.assignment-table{max-height:48vh}.assignment-table td{white-space:normal;overflow-wrap:anywhere}
.mapping-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));padding:12px 0;gap:10px}.mapping-field{display:grid;align-content:start;gap:6px}.mapping-field>label:first-child{display:grid;gap:4px}.mapping-field select{width:100%;min-width:0}.assignment-dialog footer{padding-top:10px;border-top:1px solid #e0e6ed}
</style>

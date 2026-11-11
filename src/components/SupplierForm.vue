<script setup>
import { reactive, ref, computed } from 'vue';
import { DialogContent,DialogOverlay,DialogPortal,DialogRoot,DialogTitle,DialogDescription } from 'reka-ui';
import { supplierFields, supplierMissingFields, SUPPLIER_CATEGORIES, SUPPLIER_RATINGS, TAXPAYER_TYPES, CONTACT_FIELDS, INVOICE_FIELDS } from '../lib/supplier-schema.js';
import { supplierStore, saveSuppliers, normalizeCompanyName } from '../lib/supplier-db.js';
import { directory } from '../lib/expense-directory.js';
import { saveLedgerAttachment } from '../lib/ledger-attachments.js';
import SupplierAttachments from './SupplierAttachments.vue';
import { toast,toastError,toastWarn } from '../lib/toast.js';
const props=defineProps({record:{type:Object,required:true},isNew:Boolean});
const emit=defineEmits(['close','saved']);
const draft=reactive({...JSON.parse(JSON.stringify(props.record)),aliasesText:(props.record.aliases||[]).join('、'),attachments:[...(props.record.attachments||[])]});
const saving=ref(false),missing=ref([]);
const options={category:SUPPLIER_CATEGORIES,rating:SUPPLIER_RATINGS,taxpayerType:TAXPAYER_TYPES};
const fields=computed(()=>supplierFields(draft.type));
const contacts=computed(()=>draft.type==='房东'?CONTACT_FIELDS.slice(0,2):CONTACT_FIELDS);
const invoices=computed(()=>draft.type==='房东'?INVOICE_FIELDS.slice(0,3):INVOICE_FIELDS);
function close(){if(!saving.value)emit('close');}
async function save(mode){
 if(saving.value)return;
 const name=String(draft.name||'').trim();
 if(name.length<2){toastWarn('请填写分供方名称（至少两个字）');return;}
 if(supplierStore.list.some(s=>s.id!==draft.id&&normalizeCompanyName(s.name)===normalizeCompanyName(name))){toastWarn('已有同名分供方，请编辑原档案');return;}
 missing.value=supplierMissingFields(draft);
 if(mode!=='draft'&&missing.value.length){toastWarn('请补充必填信息，或先保存草稿');return;}
 saving.value=true;
 try{
  const attachments=[];
  for(const a of draft.attachments){const {file,...meta}=a;if(file){meta.key='supplier:'+draft.id+':'+a.id;await saveLedgerAttachment(meta.key,file);}attachments.push(meta);}
  const {aliasesText,...rest}=draft;
  const record={...rest,name,aliases:aliasesText.split(/[、,，;；/]+/).map(v=>v.trim()).filter(Boolean),attachments,status:mode==='draft'?'待补全':'已建档'};
  const next=supplierStore.list.map(s=>s.id===record.id?record:s);if(!next.some(s=>s.id===record.id))next.push(record);
  saveSuppliers(next);toast('分供方已保存'+(mode==='draft'?'，资料可稍后补充':''));emit('saved',mode==='new');
 }catch(e){toastError('保存失败：'+e.message);}finally{saving.value=false;}
}
</script>
<template>
 <DialogRoot :open="true" @update:open="value=>{if(!value)close()}"><DialogPortal><DialogOverlay class="supplier-overlay" /><DialogContent class="supplier-form-dialog" @escape-key-down="saving&&$event.preventDefault()" @pointer-down-outside.prevent>
  <header><button class="text-action" :disabled="saving" @click="close">× 关闭</button><DialogTitle>{{ isNew?'新建分供方':'编辑分供方' }} · {{ draft.type }}</DialogTitle></header>
  <DialogDescription class="supplier-description">可先保存草稿，附件资料后续补充。带 * 的信息用于完成建档。</DialogDescription>
  <main>
   <details open><summary>基础信息<span>*</span></summary><div class="supplier-fields"><label v-for="field in fields" :key="field.key">{{ field.label }}<span v-if="field.required">*</span>
    <textarea v-if="field.input==='textarea'" v-model="draft[field.key]" rows="3" />
    <select v-else-if="options[field.input]" v-model="draft[field.key]"><option value="">请选择</option><option v-for="v in options[field.input]" :key="v">{{ v }}</option></select>
    <select v-else-if="field.input==='parent'" v-model="draft.parentSupplier"><option value="">无</option><option v-for="s in supplierStore.list.filter(s=>s.id!==draft.id)" :key="s.id" :value="s.name">{{ s.name }}</option></select>
    <input v-else v-model="draft[field.key]" :type="field.input" :step="field.input==='number'?'0.01':undefined" :min="field.input==='number'?0:undefined" />
   </label></div></details>
   <details open><summary>附件信息</summary><SupplierAttachments v-model="draft.attachments" :type="draft.type" /></details>
   <template v-if="draft.type!=='甲供材分供方'">
    <details open><summary>联系人信息</summary><div class="supplier-fields"><label v-for="([key,label],index) in contacts" :key="key">{{ label }}<span v-if="index<2">*</span><input v-model="draft[key]" /></label></div></details>
    <details open><summary>开票信息</summary><div class="supplier-fields"><label v-for="([key,label],index) in invoices" :key="key">{{ label }}<span v-if="index<3">*</span><input v-model="draft[key]" /></label></div></details>
   </template>
   <details><summary>识别与补充信息</summary><div class="supplier-fields"><label>识别别名（用顿号分隔）<input v-model="draft.aliasesText" placeholder="识别送货单文件夹简称时使用" /></label><label>合作工地<select v-model="draft.project"><option value="">未指定</option><option v-for="p in directory.projects" :key="p">{{ p }}</option></select></label><label v-for="[key,label] in [['externalCode','唯一识别码'],['manager','负责人'],['laborScope','劳务承包范围'],['businessType','业务类型'],['contactInfo','联系方式'],['otherNote','其他备注']]" :key="key">{{ label }}<input v-model="draft[key]" /></label><label>是否班组个人<select v-model="draft.isTeamIndividual"><option value="">未填写</option><option>是</option><option>否</option></select></label></div></details>
   <p v-if="missing.length" class="supplier-missing" role="alert">待补充：{{ missing.join('、') }}</p>
  </main>
  <footer><span>附件可稍后补充</span><button class="btn" :disabled="saving" @click="close">取消</button><button class="btn" :disabled="saving" @click="save('draft')">保存草稿</button><button class="btn" :disabled="saving" @click="save('new')">保存并新建</button><button class="btn-primary" :disabled="saving" @click="save('save')">{{ saving?'保存中…':'保存' }}</button></footer>
 </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.supplier-overlay{position:fixed;inset:0;background:#17283d66;z-index:60}.supplier-form-dialog{position:fixed;inset:3vh max(20px,calc((100vw - 1360px)/2));background:#fff;z-index:61;display:flex;flex-direction:column;border-radius:10px;outline:none;color:#25364a;box-shadow:0 20px 70px #14233833}.supplier-form-dialog header{display:flex;align-items:center;gap:18px;border-bottom:1px solid #e5e9ef;padding:16px 24px}.supplier-form-dialog header h2{font-size:20px;margin:0}.supplier-description{font-size:12px;color:#778599;padding:8px 32px;margin:0}.supplier-form-dialog main{overflow:auto;flex:1;padding:12px 34px 24px}.supplier-form-dialog details{margin:0 0 26px}.supplier-form-dialog summary{font-size:17px;font-weight:650;border-left:4px solid #e95460;padding-left:9px;margin-bottom:20px;cursor:pointer}.supplier-fields{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px}.supplier-fields label{display:block;font-size:14px;min-width:0}.supplier-fields input,.supplier-fields select,.supplier-fields textarea{box-sizing:border-box;display:block;width:100%;border:1px solid #d2dbe6;border-radius:4px;padding:9px 12px;margin-top:8px;background:white;color:#25364a;min-height:38px;font:inherit}.supplier-fields input:focus,.supplier-fields textarea:focus,.supplier-fields select:focus{outline:2px solid #b5d3f7;border-color:#508fdd}.supplier-fields label>span,summary>span{color:#dc3847;margin-left:3px}.supplier-form-dialog footer{border-top:1px solid #e5e9ef;padding:12px 24px;display:flex;align-items:center;gap:10px}.supplier-form-dialog footer>span{margin-right:auto;color:#8591a0;font-size:12px}.supplier-missing{background:#fff6df;padding:12px;color:#935b08;font-size:13px}@media(max-width:700px){.supplier-fields{grid-template-columns:1fr}.supplier-form-dialog main{padding:16px}.supplier-form-dialog footer{flex-wrap:wrap}}
</style>

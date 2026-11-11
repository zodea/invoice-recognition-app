<script setup>
import { supplierAttachmentGroups } from '../lib/supplier-schema.js';
import { getLedgerAttachment } from '../lib/ledger-attachments.js';
import { downloadBytes } from "../lib/file-utils.js";
import { toastWarn, toastError } from '../lib/toast.js';
const props=defineProps({type:String,modelValue:{type:Array,default:()=>[]}});
const emit=defineEmits(['update:modelValue']);
function add(group,files){
 const next=[...props.modelValue];
 for(const file of Array.from(files||[])){
  if(next.filter(f=>f.group===group.key).length>=group.limit){toastWarn(group.label+'最多 '+group.limit+' 个附件');break;}
  if(next.some(f=>f.group===group.key&&f.name===file.name&&f.size===file.size))continue;
  next.push({id:crypto.randomUUID(),group:group.key,name:file.name,size:file.size,file});
 }
 emit('update:modelValue',next);
}
async function download(item){try{const file=item.file||(await getLedgerAttachment(item.key))?.blob;if(!file)throw new Error('附件文件不存在');downloadBytes(new Uint8Array(await file.arrayBuffer()),item.name,file.type||'application/octet-stream');}catch(e){toastError(e.message);}}
</script>
<template>
 <div class="attachment-grid">
  <section v-for="group in supplierAttachmentGroups(type)" :key="group.key">
   <label>{{ group.label }}</label>
   <div class="supplier-drop" tabindex="0" :aria-label="group.label+'附件区'" @dragover.prevent @drop.prevent="add(group,$event.dataTransfer.files)" @paste="add(group,$event.clipboardData.files)">
    <label class="select-file">选择<input type="file" multiple @change="add(group,$event.target.files);$event.target.value=''" /></label>
    <span>拖拽或点击后粘贴（{{ modelValue.filter(f=>f.group===group.key).length }}/{{ group.limit }}）</span>
   </div>
   <div v-for="item in modelValue.filter(f=>f.group===group.key)" :key="item.id" class="supplier-file"><button type="button" class="text-action" :title="item.name" @click="download(item)">{{ item.name }}</button><button type="button" class="text-action" @click="emit('update:modelValue',modelValue.filter(f=>f.id!==item.id))">移除</button></div>
  </section>
 </div>
</template>
<style scoped>
.attachment-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px}.attachment-grid section{min-width:0}.attachment-grid section>label{display:block;margin-bottom:8px;font-size:14px}.supplier-drop{border:1px dashed #cdd6e2;min-height:42px;display:flex;align-items:center;justify-content:center;gap:10px;color:#8b96a5;font-size:12px;background:#fafcfe}.supplier-drop:focus-within,.supplier-drop:focus{outline:2px solid #b8d5fa;background:#f0f7ff}.select-file{cursor:pointer;background:white;border:1px solid #ccd6e2;padding:2px 12px;color:#2766a4}.select-file input{display:none}.supplier-file{display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:5px 0}.supplier-file button:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}@media(max-width:700px){.attachment-grid{grid-template-columns:1fr}}
</style>

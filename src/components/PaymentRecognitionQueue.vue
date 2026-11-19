<script setup>
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {isPdf} from '../lib/file-utils.js';
import {renderPdfPages} from '../lib/pdftext.js';
const props=defineProps({queue:Array});
const active=ref(0), urls=ref([]), error=ref(''), chosen=computed(()=>props.queue[active.value]?.file);
const done=computed(()=>props.queue.filter(t=>!['等待读取','识别中'].includes(t.state)).length);
let generation=0;
function release(){generation++;urls.value.forEach(url=>URL.revokeObjectURL(url));urls.value=[];}
watch(chosen,async file=>{
 release();error.value='';const version=generation;if(!file)return;
 try{
  const next=isPdf(file)?await renderPdfPages(file,{maxPages:20,scale:1.4}):[URL.createObjectURL(file)];
  if(version===generation)urls.value=next;else next.forEach(url=>URL.revokeObjectURL(url));
 }catch(e){if(version===generation)error.value=e.message;}
},{immediate:true});
onBeforeUnmount(release);
</script>
<template><section class="queue-workbench"><div class="queue-pane"><header><strong>凭证识别</strong><span>{{ done }} / {{ queue.length }}</span></header>
<progress :value="done" :max="queue.length" aria-label="凭证识别进度"></progress><div class="queue-list"><button v-for="(task,i) in queue" :key="i" :aria-pressed="active===i" @click="active=i"><span>{{ task.file.name }}<small>{{ task.detail }}</small></span><b>{{ task.state }}</b></button></div></div>
<div v-if="chosen" class="queue-pane"><strong>{{ chosen.name }}</strong><div class="queue-preview"><img v-for="(url,i) in urls" :key="url" :src="url" :alt="'凭证原件第 '+(i+1)+' 页'"><span v-if="!urls.length">{{ error||'正在载入原件…' }}</span></div></div></section></template>
<style scoped>
.queue-workbench{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);margin:12px 20px;gap:12px}.queue-pane{min-width:0;border:1px solid #dce4ed;border-radius:8px;padding:12px;display:grid;align-content:start;gap:8px}.queue-pane header,.queue-list button{display:flex;align-items:center;justify-content:space-between;gap:10px}.queue-pane progress{width:100%;accent-color:#1867c0}.queue-list,.queue-preview{overflow:auto;height:230px}.queue-list button{width:100%;border:0;border-bottom:1px solid #e3eaf1;background:white;text-align:left;padding:9px}.queue-list button[aria-pressed=true]{background:#eaf3fc}.queue-list b{flex:none;color:#32648a;font-size:12px}.queue-list small{display:block;color:#64748b}.queue-list span,.queue-pane strong{overflow-wrap:anywhere}.queue-preview{background:#f3f5f8;text-align:center}.queue-preview img{display:block;margin:auto;max-width:100%;height:100%;object-fit:contain}@media(max-width:760px){.queue-workbench{grid-template-columns:minmax(0,1fr)}}
</style>
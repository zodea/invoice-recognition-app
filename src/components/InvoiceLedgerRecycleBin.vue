<script setup>
import { computed, ref } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import MiddleEllipsis from './MiddleEllipsis.vue';
const props = defineProps({ message: String, records: { type: Array, required: true }, ledger: { type: Object, required: true } });
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(['restore']);
const query = ref('');
const filtered = computed(() => props.records.filter(r => `${r.entry.number || r.key} ${r.entry.buyer || ''} ${r.entry.seller || ''}`.includes(query.value.trim())));
const restorable = computed(() => filtered.value.filter(r => !Object.hasOwn(props.ledger, r.key)));
</script>
<template>
  <DialogRoot v-model:open="open"><DialogPortal><DialogOverlay class="trash-overlay" /><DialogContent class="trash-dialog">
    <header class="trash-header"><DialogTitle>发票回收站（{{ records.length }}）</DialogTitle><button class="btn" @click="open=false">关闭回收站</button></header>
    <DialogDescription>删除的记录保留原件，可恢复到台账。同号码已存在时不会覆盖现有记录。</DialogDescription>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="trash-tools"><input v-model="query" class="field-input" aria-label="搜索回收站" placeholder="搜索号码或公司" /><button class="btn" :disabled="!restorable.length" @click="emit('restore',restorable.map(r=>r.id))">恢复筛选结果（{{ restorable.length }}）</button></div>
    <div class="trash-table-wrap"><table class="trash-table"><thead><tr><th>发票号码</th><th>购买方</th><th>销售方</th><th>删除时间</th><th>操作</th></tr></thead><tbody>
      <tr v-for="r in filtered" :key="r.id"><td>{{ r.entry.number || r.key }}</td><td><MiddleEllipsis :text="r.entry.buyer || '—'" class="trash-company" :tail="6" /></td><td><MiddleEllipsis :text="r.entry.seller || '—'" class="trash-company" :tail="6" /></td><td>{{ new Date(r.deletedAt).toLocaleString('zh-CN') }}</td><td><span v-if="Object.hasOwn(ledger,r.key)">同号码已存在</span><button v-else class="btn" @click="emit('restore',[r.id])">恢复</button></td></tr>
      <tr v-if="!filtered.length"><td colspan="5">{{ records.length?'没有符合条件的记录':'回收站为空' }}</td></tr>
    </tbody></table></div>
  </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.trash-overlay{position:fixed;inset:0;background:#0f172a66;z-index:60}.trash-dialog{position:fixed;inset:8vh 4vw;z-index:61;background:white;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:14px;color:#263548;max-width:1100px;margin:auto;outline:none}.trash-header,.trash-tools{display:flex;align-items:center;justify-content:space-between;gap:12px}.trash-header h2{margin:0;font-size:20px}.trash-tools input{max-width:350px}.trash-table-wrap{overflow:auto;min-height:0}.trash-table{width:100%;border-collapse:collapse;font-size:12px}.trash-table th,.trash-table td{text-align:left;padding:12px;border-bottom:1px solid #e3e9f0;white-space:nowrap}.trash-company{width:180px;max-width:180px}
</style>

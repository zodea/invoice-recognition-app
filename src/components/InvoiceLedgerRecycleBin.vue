<script setup>
import { computed, ref } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import MiddleEllipsis from './MiddleEllipsis.vue';
import ConfirmAction from './ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const props = defineProps({ message: String, busy: Boolean, pendingCleanup: Number, records: { type: Array, required: true }, ledger: { type: Object, required: true } });
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(['restore', 'purge', 'retry']);
const query = ref('');
const filtered = computed(() => props.records.filter(r => `${r.entry.number || r.key} ${r.entry.buyer || ''} ${r.entry.seller || ''}`.includes(query.value.trim())));
const restorable = computed(() => filtered.value.filter(r => !Object.hasOwn(props.ledger, r.key)));
async function confirmPurge(records, all = false) {
 if (props.busy || !records.length) return;
 const label = all ? '清空回收站' : '永久删除';
 const ok = await requestConfirmation(label+'（'+records.length+' 张）',
  '这 '+records.length+' 张记录将永久删除，无法从回收站恢复。软件内不再被台账或其他回收站记录引用的原件副本也会清理；电脑原文件夹中的文件不受影响。', label);
 if(ok) emit('purge', records.map(r=>r.id));
}
</script>
<template>
  <DialogRoot v-model:open="open"><DialogPortal><DialogOverlay class="trash-overlay" /><DialogContent class="trash-dialog">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" /><header class="trash-header"><DialogTitle>发票回收站（{{ records.length }}）</DialogTitle><button class="btn" @click="open=false">关闭回收站</button></header>
    <DialogDescription>回收站永久保留，不自动过期。可恢复或手动永久删除；同号码已存在时恢复不会覆盖现有记录。永久删除不可恢复，只清理软件内不再被引用的原件副本。</DialogDescription>
    <p v-if="message" role="status">{{ message }}</p>
    <div class="trash-tools"><input v-model="query" class="field-input" aria-label="搜索回收站" placeholder="搜索号码或公司" /><button class="btn" :disabled="busy || !restorable.length" @click="emit('restore',restorable.map(r=>r.id))">恢复筛选结果（{{ restorable.length }}）</button><button class="btn-danger" :disabled="busy || !records.length" @click="confirmPurge(records,true)">清空回收站（{{ records.length }}）</button></div><div v-if="pendingCleanup"><button class="btn" :disabled="busy" @click="emit('retry')">重试原件清理（{{ pendingCleanup }}）</button></div><p v-if="busy" role="status">正在清理，请稍候…</p>
    <div class="trash-table-wrap"><table class="trash-table"><thead><tr><th>发票号码</th><th>购买方</th><th>销售方</th><th>删除时间</th><th>操作</th></tr></thead><tbody>
      <tr v-for="r in filtered" :key="r.id"><td>{{ r.entry.number || r.key }}</td><td><MiddleEllipsis :text="r.entry.buyer || '—'" class="trash-company" :tail="6" /></td><td><MiddleEllipsis :text="r.entry.seller || '—'" class="trash-company" :tail="6" /></td><td>{{ new Date(r.deletedAt).toLocaleString('zh-CN') }}</td><td><span v-if="Object.hasOwn(ledger,r.key)">同号码已存在</span><button v-else class="btn" :disabled="busy" @click="emit('restore',[r.id])">恢复</button><button class="btn-danger" :disabled="busy" @click="confirmPurge([r])">永久删除</button></td></tr>
      <tr v-if="!filtered.length"><td colspan="5">{{ records.length?'没有符合条件的记录':'回收站为空' }}</td></tr>
    </tbody></table></div>
  </DialogContent></DialogPortal></DialogRoot>
</template>
<style scoped>
.trash-overlay{position:fixed;inset:0;background:#0f172a66;z-index:60}.trash-dialog{position:fixed;inset:8vh 4vw;z-index:61;background:white;border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:14px;color:#263548;max-width:1100px;margin:auto;outline:none}.trash-header,.trash-tools{display:flex;align-items:center;justify-content:space-between;gap:12px}.trash-header h2{margin:0;font-size:20px}.trash-tools input{max-width:350px}.trash-table-wrap{overflow:auto;min-height:0}.trash-table{width:100%;border-collapse:collapse;font-size:12px}.trash-table th,.trash-table td{text-align:left;padding:12px;border-bottom:1px solid #e3e9f0;white-space:nowrap}.trash-company{width:180px;max-width:180px}
.trash-tools{flex-wrap:wrap}.trash-table td:last-child{display:flex;align-items:center;gap:8px}.trash-dialog p{margin:0;font-size:12px;line-height:1.6}.trash-dialog button{font-size:12px;padding:5px 9px;min-height:30px}
</style>

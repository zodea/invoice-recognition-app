<script setup>
import { computed, ref, watch } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { directory, deleteArchive, restoreArchive, purgeDeletedArchives, saveDirectory, isAllocationRuleActive } from '../lib/expense-directory.js';
import MiddleEllipsis from './MiddleEllipsis.vue';
import ConfirmAction from './ConfirmAction.vue';
import { toast, toastError } from '../lib/toast.js';
import { useConfirmation } from '../composables/useConfirmation.js';

const props = defineProps({ kinds: { type: Object, required: true } });
const open = defineModel('open', { type: Boolean, default: false });
const mode = defineModel('mode', { type: String, default: 'archives' });
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const query = ref(''), kind = ref('all'), page = ref(1);
const pageSize = 8;
const titles = { archives: '档案清单', rules: '厂家归属清单', trash: '档案回收站' };
const records = computed(() => mode.value === 'rules' ? directory.rules : mode.value === 'trash' ? directory.deletedArchives :
  Object.keys(props.kinds).flatMap(type => directory[type].map(value => ({ kind: type, value }))));
const filtered = computed(() => {
  const q = query.value.trim().normalize('NFKC').toLocaleLowerCase();
  return records.value.filter(record => {
    if (mode.value !== 'rules' && kind.value !== 'all' && record.kind !== kind.value) return false;
    return (mode.value === 'rules' ? `${record.seller} ${record.buyer} ${record.project}` : record.value).normalize('NFKC').toLocaleLowerCase().includes(q);
  });
});
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
watch([query, kind, mode, open], () => { page.value = 1; });
watch(mode, () => { query.value = ''; kind.value = 'all'; });
watch(pageCount, count => { page.value = Math.min(page.value, count); });

async function remove(record) {
  if (!await requestConfirmation('删除'+props.kinds[record.kind], '删除“'+record.value+'”？已有票据内容保留，相关归属规则暂停使用；可在档案回收站恢复。')) return;
  try { deleteArchive(record.kind, record.value); toast('已移入档案回收站。'); }
  catch (error) { toastError('删除失败：'+error.message); }
}
function restore(record) {
  try { restoreArchive(record.kind, record.value); toast('档案已恢复。'); }
  catch (error) { toastError('恢复失败：'+error.message); }
}
async function purge(items, all = false) {
  if (!items.length) return;
  const label = all ? '清空档案回收站' : '永久删除';
  if (!await requestConfirmation(label+'（'+items.length+' 项）', '这 '+items.length+' 项档案备份将永久删除，无法恢复。历史票据中的名称保留；相关归属规则仍保持停用，可在厂家归属清单移除。', label)) return;
  try { toast('已永久删除 '+purgeDeletedArchives(items)+' 项档案备份。'); }
  catch (error) { toastError('永久删除失败：'+error.message); }
}
async function removeRule(record) {
  if (!await requestConfirmation('移除厂家归属', '移除“'+record.seller+'”的这条归属规则？已保存票据的费用归属保留。', '移除规则')) return;
  try { saveDirectory({ ...directory, rules: directory.rules.filter(item => item !== record) }); toast('归属规则已移除。'); }
  catch (error) { toastError('移除失败：'+error.message); }
}
</script>

<template>
  <DialogRoot v-model:open="open"><DialogPortal><DialogOverlay class="directory-overlay" /><DialogContent class="directory-dialog">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <header><DialogTitle>{{ titles[mode] }}</DialogTitle><button class="btn" @click="open=false">关闭清单</button></header>
    <DialogDescription>{{ mode === 'trash' ? '已删除档案一直保留，直到手动永久删除。可恢复单项，也可清空全部。' : mode === 'rules' ? '查看厂家对应的购买方与工地，可搜索厂家、公司或工地名称。' : '按类型查看已添加的档案，支持搜索和分页。' }}</DialogDescription>
    <div class="records-tools">
      <label v-if="mode !== 'rules'">类型<select v-model="kind" class="field-input"><option value="all">全部类型</option><option v-for="(label,key) in kinds" :key="key" :value="key">{{ label }}</option></select></label>
      <input v-model="query" class="field-input records-search" :aria-label="'搜索'+titles[mode]" placeholder="输入名称搜索" type="search" />
      <span>共 {{ filtered.length }} 项</span>
      <button v-if="mode === 'trash'" class="btn-danger" :disabled="!directory.deletedArchives.length" @click="purge([...directory.deletedArchives],true)">清空全部（{{ directory.deletedArchives.length }}）</button>
    </div>
    <div class="records-table-wrap"><table class="records-table">
      <thead><tr v-if="mode === 'rules'"><th>厂家 / 销售方</th><th>购买方</th><th>工地</th><th>状态</th><th>操作</th></tr><tr v-else><th class="kind-column">类型</th><th>档案名称</th><th v-if="mode === 'trash'">删除时间</th><th class="actions-column">操作</th></tr></thead>
      <tbody>
        <tr v-for="record in paged" :key="mode==='rules'?JSON.stringify([record.seller,record.buyer,record.project]):JSON.stringify([record.kind,record.value])">
          <template v-if="mode==='rules'"><td><MiddleEllipsis :text="record.seller" :tail="6" /></td><td><MiddleEllipsis :text="record.buyer" :tail="6" /></td><td><MiddleEllipsis :text="record.project" :tail="6" /></td><td><span :title="isAllocationRuleActive(record)?'':'购买方或工地已删除，恢复档案后重新启用'">{{ isAllocationRuleActive(record)?'启用':'已停用' }}</span></td><td><button class="text-action" @click="removeRule(record)">移除</button></td></template>
          <template v-else><td>{{ kinds[record.kind] }}</td><td><MiddleEllipsis :text="record.value" :tail="8" /></td><td v-if="mode==='trash'">{{ record.deletedAt ? new Date(record.deletedAt).toLocaleString('zh-CN') : '—' }}</td><td><div class="record-actions"><template v-if="mode==='trash'"><button class="text-action" @click="restore(record)">恢复</button><button class="text-action danger" @click="purge([record])">永久删除</button></template><button v-else class="text-action danger" :aria-label="'删除档案 '+record.value" @click="remove(record)">删除</button></div></td></template>
        </tr>
        <tr v-if="!paged.length"><td :colspan="mode==='rules'?5:mode==='trash'?4:3" class="records-empty">{{ records.length?'没有符合条件的记录':mode==='trash'?'档案回收站为空':'暂无记录' }}</td></tr>
      </tbody>
    </table></div>
    <footer><span>每页 {{ pageSize }} 项</span><button class="btn" :disabled="page<=1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button class="btn" :disabled="page>=pageCount" @click="page++">下一页</button></footer>
  </DialogContent></DialogPortal></DialogRoot>
</template>

<style scoped>
.directory-overlay{position:fixed;inset:0;background:#0f172a66;z-index:60}
.directory-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(1040px,94vw);max-height:88vh;z-index:61;display:flex;flex-direction:column;gap:12px;background:#fff;border-radius:10px;padding:18px;color:#263548;outline:none;box-sizing:border-box}
.directory-dialog header,.directory-dialog footer{display:flex;align-items:center;gap:10px;flex-shrink:0}.directory-dialog header{justify-content:space-between}.directory-dialog h2{font-size:18px;margin:0}.directory-dialog p{margin:0;color:#64748b;font-size:12px;line-height:1.6}
.records-tools{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px}.records-tools label{display:flex;align-items:center;gap:6px;white-space:nowrap}.records-tools select{width:130px}.records-search{width:240px;max-width:100%}.records-tools>button{margin-left:auto}.directory-dialog .field-input{height:32px;padding:4px 8px;font-size:12px}
.records-table-wrap{min-height:0;overflow:auto}.records-table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:12px}.records-table th,.records-table td{padding:9px 10px;border-bottom:1px solid #e3e9f0;text-align:left}.records-table th{background:#f7f9fc;color:#64748b}.kind-column{width:100px}.actions-column{width:130px}.records-table :deep(.middle-ellipsis){width:100%;max-width:100%}.record-actions{display:flex;gap:12px;white-space:nowrap}.directory-dialog .text-action{border:0;background:none;font-size:12px;cursor:pointer;color:#1867c0;padding:3px 0}.directory-dialog .danger{color:#b91c1c}.records-table .records-empty{text-align:center;padding:45px 10px;color:#64748b}.directory-dialog .records-message{background:#fffbeb;color:#92400e;padding:5px 10px}.directory-dialog footer{justify-content:flex-end;font-size:12px}.directory-dialog footer>span:first-child{margin-right:auto}.directory-dialog .btn,.directory-dialog .btn-danger{font-size:12px;padding:5px 9px;min-height:30px}
@media(max-width:700px){.directory-dialog{padding:12px}.records-table{min-width:600px}.records-tools .records-search{width:180px}}
</style>

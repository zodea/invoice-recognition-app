<script setup>
import { computed, ref, watch } from 'vue';
import { directory, addArchiveAlias, removeArchiveAlias, resolveArchiveName } from '../lib/expense-directory.js';
import ConfirmAction from './ConfirmAction.vue';
import MiddleEllipsis from './MiddleEllipsis.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
import { toast, toastError } from '../lib/toast.js';

const props = defineProps({ stats: Object });
const query = ref(''), name = ref(''), kind = ref('buyers'), target = ref('');
const targets = computed(() => directory[kind.value]);
watch(targets, values => { if (!values.includes(target.value)) target.value = ''; });
watch(kind, () => { target.value = ''; });
const filtered = computed(() => {
  const key = query.value.trim().normalize('NFKC').toLowerCase();
  return directory.aliases.filter(item => (item.name + ' ' + item.target).normalize('NFKC').toLowerCase().includes(key));
});
const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
function add() {
  try {
    addArchiveAlias({ name: name.value.trim(), kind: kind.value, target: target.value });
    name.value = '';
    toast('已新增别名');
  } catch (error) { toastError(error.message); }
}
async function remove(alias) {
  const count = props.stats[alias.kind]?.get(alias.target)?.count || 0;
  if (!await requestConfirmation('删除别名', '将“' + alias.name + '”移入档案回收站？标准名“' + alias.target + '”关联 ' + count + ' 条记录，原记录保留。')) return;
  try { removeArchiveAlias(alias); toast('已移入档案回收站。'); }
  catch (error) { toastError('删除失败：' + error.message); }
}
</script>

<template>
  <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
  <section class="ui-panel flex min-h-95 flex-col overflow-hidden">
    <header class="ui-section-header"><h3 class="text-sm font-semibold">别名映射词典</h3></header>
    <form class="grid gap-2 border-b border-line px-3 py-2.5" @submit.prevent="add">
      <input v-model="query" type="search" class="ui-input" aria-label="搜索别名词典" placeholder="搜索别名或标准名" />
      <div class="flex gap-1.5">
        <input v-model="name" class="ui-input" placeholder="输入别名" aria-label="新增别名" required />
        <select v-model="kind" class="ui-input w-24 shrink-0" aria-label="别名档案类型"><option value="buyers">购买方</option><option value="projects">工地</option></select>
        <button type="submit" class="ui-btn-primary" :disabled="!target">新增</button>
      </div>
      <select v-model="target" class="ui-input" aria-label="别名标准名" required><option value="">选择档案标准名</option><option v-for="value in targets" :key="value">{{ value }}</option></select>
    </form>
    <ul class="max-h-[48vh] flex-1 overflow-auto px-3 py-1">
      <li v-for="item in filtered" :key="item.name" class="flex min-w-0 items-center gap-2 border-b border-line-subtle py-1.5">
        <div class="min-w-0 flex-1"><MiddleEllipsis :text="item.name" /><div class="truncate text-xs text-ink-soft" :title="item.target">{{ item.kind === 'buyers' ? '购买方' : '工地' }} · {{ item.target }}</div></div>
        <span v-if="resolveArchiveName(item.kind, item.name) !== item.target" class="ui-badge-warn">已停用</span>
        <button class="ui-btn-ghost h-7 text-xs text-danger" type="button" :aria-label="'删除别名 ' + item.name" @click="remove(item)">删除</button>
      </li>
      <li v-if="!filtered.length" class="px-1 py-5 text-xs text-ink-soft">{{ query ? '没有匹配的别名' : '暂无别名' }}</li>
    </ul>
  </section>
</template>

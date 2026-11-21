<script setup>
import { useDebouncedFilter } from '../composables/useDebouncedFilter.js';
import { computed, ref } from 'vue';

const props = defineProps({ title: String, groups: Array, stats: Object });
const emit = defineEmits(['add', 'remove']);
const kind = ref(props.groups[0].kind);
const query = ref('');
const { applied: appliedQuery } = useDebouncedFilter(query);
const name = ref('');
const filtered = computed(() => {
  const key = appliedQuery.value.trim().normalize('NFKC').toLowerCase();
  return props.groups.map(group => ({ ...group, names: group.names.filter(value => value.normalize('NFKC').toLowerCase().includes(key)) }));
});
function add() {
  const value = name.value.trim();
  if (!value) return;
  emit('add', kind.value, value);
  name.value = '';
}
</script>

<template>
  <section class="ui-panel flex min-h-95 flex-col overflow-hidden">
    <header class="ui-section-header"><h3 class="text-sm font-semibold">{{ title }}</h3><slot name="actions" /></header>
    <div class="grid gap-2 border-b border-line px-3 py-2.5">
      <input v-model="query" type="search" class="ui-input" :aria-label="'搜索' + title" :placeholder="'搜索' + title" />
      <form class="flex gap-1.5" @submit.prevent="add">
        <select v-if="groups.length > 1" v-model="kind" class="ui-input w-22 shrink-0" aria-label="新增类型"><option v-for="group in groups" :key="group.kind" :value="group.kind">{{ group.label }}</option></select>
        <input v-model="name" class="ui-input" :aria-label="'新增' + title + '名称'" placeholder="输入名称" required />
        <button type="submit" class="ui-btn-primary">新增</button>
      </form>
    </div>
    <div class="max-h-[48vh] flex-1 overflow-auto px-3 py-1">
      <template v-for="group in filtered" :key="group.kind">
        <h4 v-if="groups.length > 1 && group.names.length" class="pt-2 text-xs font-medium text-ink-soft">{{ group.label }}</h4>
        <ul>
          <li v-for="value in group.names" :key="value" class="flex min-w-0 items-center gap-2 border-b border-line-subtle py-1.5">
            <MiddleEllipsis :text="value" class="min-w-0 flex-1" />
            <span v-if="stats[group.kind]" class="ui-badge-neutral ui-money">{{ stats[group.kind]?.get(value)?.count || 0 }} 条</span>
            <span v-if="group.kind === 'projects'" class="ui-money text-xs text-ink-secondary">¥{{ stats.projects?.get(value)?.total || '0.00' }}</span>
            <button type="button" class="ui-btn-ghost h-7 text-xs text-danger" :aria-label="'删除档案 ' + value" @click="emit('remove', group.kind, value)">删除</button>
          </li>
        </ul>
      </template>
      <p v-if="!filtered.some(group => group.names.length)" class="px-1 py-5 text-xs text-ink-soft">{{ query ? '没有匹配的档案' : '暂无档案' }}</p>
    </div>
  </section>
</template>

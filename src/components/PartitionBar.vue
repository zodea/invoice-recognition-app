<script setup>
import { ref } from "vue";
import { store, actions } from "../store";

const editingId = ref("");
const editName = ref("");

function countOf(id) {
  return store.files.filter((f) => f.partitionId === id).length;
}
function startEdit(p) {
  editingId.value = p.id;
  editName.value = p.name;
}
function commitEdit() {
  if (editingId.value) actions.renamePartition(editingId.value, editName.value);
  editingId.value = "";
}
function addNew() {
  const name = window.prompt("新建项目分区名称（例如：A栋机电、地下室、消防）", "");
  if (name && name.trim()) actions.addPartition(name);
}
function remove(p) {
  if (countOf(p.id) > 0 && !window.confirm(`分区【${p.name}】里还有 ${countOf(p.id)} 个文件，删除后会移到其它分区。继续？`)) return;
  if (!actions.removePartition(p.id)) window.alert("至少保留一个分区。");
}

const chipBase = "inline-flex items-center gap-1.5 border bg-white text-ink px-2.5 py-1.25 rounded-full cursor-pointer";
function chipCls(active) {
  return active ? `${chipBase} border-brand bg-brand-soft text-brand` : `${chipBase} border-line-strong`;
}
</script>

<template>
  <div class="flex flex-wrap gap-2 items-center px-3.5 py-3 panel">
    <span class="text-ink-soft font-600">项目分区：</span>
    <button :class="chipCls(store.activePartitionId === 'all')" @click="actions.setActivePartition('all')">
      全部 <em class="not-italic text-ink-soft bg-bg rounded-full px-1.75 text-xs">{{ store.files.length }}</em>
    </button>
    <template v-for="p in store.partitions" :key="p.id">
      <span v-if="editingId === p.id" :class="chipBase">
        <input class="border-none outline-none w-24 font-inherit bg-transparent" v-model="editName" @keyup.enter="commitEdit" @blur="commitEdit" autofocus />
      </span>
      <button
        v-else
        :class="[chipCls(store.activePartitionId === p.id), store.activePartitionId === p.id ? '[&_em]:text-brand' : '']"
        @click="actions.setActivePartition(p.id)"
        @dblclick="startEdit(p)"
        title="双击重命名"
      >
        {{ p.name }} <em class="not-italic text-ink-soft bg-bg rounded-full px-1.75 text-xs">{{ countOf(p.id) }}</em>
        <span class="text-ink-soft ml-0.5 font-700 hover:text-danger" @click.stop="remove(p)" title="删除分区">×</span>
      </button>
    </template>
    <button :class="`${chipBase} border-dashed border-line-strong text-brand`" @click="addNew">＋ 新建分区</button>
  </div>
</template>

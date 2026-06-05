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
</script>

<template>
  <div class="bar">
    <span class="label">项目分区：</span>
    <button class="chip" :class="{ active: store.activePartitionId === 'all' }" @click="actions.setActivePartition('all')">
      全部 <em>{{ store.files.length }}</em>
    </button>
    <template v-for="p in store.partitions" :key="p.id">
      <span v-if="editingId === p.id" class="chip editing">
        <input v-model="editName" @keyup.enter="commitEdit" @blur="commitEdit" autofocus />
      </span>
      <button
        v-else
        class="chip"
        :class="{ active: store.activePartitionId === p.id }"
        @click="actions.setActivePartition(p.id)"
        @dblclick="startEdit(p)"
        :title="'双击重命名'"
      >
        {{ p.name }} <em>{{ countOf(p.id) }}</em>
        <span class="x" @click.stop="remove(p)" title="删除分区">×</span>
      </button>
    </template>
    <button class="chip add" @click="addNew">＋ 新建分区</button>
  </div>
</template>

<style scoped>
.bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 12px 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.label {
  color: var(--ink-soft);
  font-weight: 600;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line-strong);
  background: #fff;
  color: var(--ink);
  padding: 5px 10px;
  border-radius: 999px;
}
.chip em {
  font-style: normal;
  color: var(--ink-soft);
  background: var(--bg);
  border-radius: 999px;
  padding: 0 7px;
  font-size: 12px;
}
.chip.active {
  border-color: var(--brand);
  background: var(--brand-soft);
  color: var(--brand);
}
.chip.active em {
  color: var(--brand);
}
.chip.add {
  border-style: dashed;
  color: var(--brand);
}
.chip .x {
  color: var(--ink-soft);
  margin-left: 2px;
  font-weight: 700;
}
.chip .x:hover {
  color: var(--danger);
}
.chip.editing input {
  border: none;
  outline: none;
  width: 96px;
  font: inherit;
}
</style>

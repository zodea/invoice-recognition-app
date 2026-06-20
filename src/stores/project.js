// 施工项目 pinia store（DESIGN-project-worker.md §4.1）。包一层 project-db 的 localStorage 读写，
// 让「施工项目列表」与「项目详情(路由页)」共享同一份状态（沿用 supplier store 模式）。
import { defineStore } from "pinia";
import { ref } from "vue";
import { loadProjects, saveProjects } from "../lib/project-db";
import { normalizeCompanyName } from "../lib/supplier-db";

export const useProjectStore = defineStore("project", () => {
  const list = ref(loadProjects());

  function persist() {
    saveProjects(list.value);
  }
  function byId(id) {
    return list.value.find((p) => p.id === id) || null;
  }
  // 同名校验（排除自己），返回撞名的那条或 null。
  function findDuplicate(name, exceptId) {
    const n = normalizeCompanyName(name);
    return list.value.find((p) => p.id !== exceptId && normalizeCompanyName(p.name) === n) || null;
  }
  function add(record) {
    list.value.push(record);
    persist();
  }
  function update(record) {
    const i = list.value.findIndex((p) => p.id === record.id);
    if (i >= 0) list.value.splice(i, 1, record);
    persist();
  }
  function remove(id) {
    const i = list.value.findIndex((p) => p.id === id);
    if (i >= 0) list.value.splice(i, 1);
    persist();
  }

  return { list, persist, byId, findDuplicate, add, update, remove };
});

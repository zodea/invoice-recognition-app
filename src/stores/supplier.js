// 分供方 pinia store（issue #21 增量迁移的第一条线）。
// 包一层 supplier-db 的 localStorage 读写，让「分供方列表」与「分供方详情(路由页)」共享同一份状态，
// 替代原来 SupplierView 内的局部 reactive（详情曾是模态、各持各的）。
import { defineStore } from "pinia";
import { ref } from "vue";
import { loadSuppliers, saveSuppliers, normalizeCompanyName } from "../lib/supplier-db";

export const useSupplierStore = defineStore("supplier", () => {
  const list = ref(loadSuppliers());

  function persist() {
    saveSuppliers(list.value);
  }
  function byId(id) {
    return list.value.find((s) => s.id === id) || null;
  }
  // 同名校验（排除自己），返回撞名的那条或 null。
  function findDuplicate(name, exceptId) {
    const n = normalizeCompanyName(name);
    return list.value.find((s) => s.id !== exceptId && normalizeCompanyName(s.name) === n) || null;
  }
  function add(record) {
    list.value.push(record);
    persist();
  }
  function update(record) {
    const i = list.value.findIndex((s) => s.id === record.id);
    if (i >= 0) list.value.splice(i, 1, record);
    persist();
  }
  function remove(id) {
    const i = list.value.findIndex((s) => s.id === id);
    if (i >= 0) list.value.splice(i, 1);
    persist();
  }

  return { list, persist, byId, findDuplicate, add, update, remove };
});

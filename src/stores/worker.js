// 工人信息 pinia store（DESIGN-project-worker.md §4.2）。包一层 worker-db 的 localStorage 读写。
// 额外方法：byProject（按项目筛选）、expiringCerts（N 天内证书到期的工人）。
import { defineStore } from "pinia";
import { ref } from "vue";
import { loadWorkers, saveWorkers, certExpiryStatus } from "../lib/worker-db";
import { normalizeCompanyName } from "../lib/supplier-db";

export const useWorkerStore = defineStore("worker", () => {
  const list = ref(loadWorkers());

  function persist() {
    saveWorkers(list.value);
  }
  function byId(id) {
    return list.value.find((w) => w.id === id) || null;
  }
  function add(record) {
    list.value.push(record);
    persist();
  }
  function update(record) {
    const i = list.value.findIndex((w) => w.id === record.id);
    if (i >= 0) list.value.splice(i, 1, record);
    persist();
  }
  function remove(id) {
    const i = list.value.findIndex((w) => w.id === id);
    if (i >= 0) list.value.splice(i, 1);
    persist();
  }
  // 按项目名筛选工人（项目名归一化匹配 currentProject）。
  function byProject(projectName) {
    const n = normalizeCompanyName(projectName);
    if (!n) return [];
    return list.value.filter((w) => normalizeCompanyName(w.currentProject) === n);
  }
  // 返回 days 天内（含已过期）有证书到期的工人列表，带命中的证书。
  function expiringCerts(days = 30) {
    const out = [];
    for (const w of list.value) {
      const hits = (w.certs || []).filter((c) => {
        const s = certExpiryStatus(c.expiryDate, days);
        return s === "expired" || s === "soon";
      });
      if (hits.length) out.push({ worker: w, certs: hits });
    }
    return out;
  }

  return { list, persist, byId, add, update, remove, byProject, expiringCerts };
});

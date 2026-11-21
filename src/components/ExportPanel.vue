<script setup>
import { ref, computed } from "vue";
import { store } from "../store";
import { exportToDirectory, exportByDownload, fsAccessSupported } from "../lib/export";
import { toast, toastError, toastInfo } from "../lib/toast";
import ConfirmAction from "./ConfirmAction.vue";
import { useConfirmation } from "../composables/useConfirmation.js";

const { confirmation, requestConfirmation, answerConfirmation } = useConfirmation();
const busy = ref(false);
const logs = ref([]);

const supported = fsAccessSupported();

const stats = computed(() => {
  const companies = new Set(store.files.map((f) => (f.company || "").trim() || "未命名公司"));
  const noCompany = store.files.filter((f) => !(f.company || "").trim()).length;
  const usedPartitions = store.partitions.filter((p) => store.files.some((f) => f.partitionId === p.id));
  return { files: store.files.length, companies: companies.size, noCompany, partitions: usedPartitions.length };
});

function log(msg) {
  logs.value.push(msg);
}

async function doExport() {
  if (!store.files.length) {
    toastInfo("还没有文件可导出。");
    return;
  }
  if (stats.value.noCompany > 0) {
    if (!await requestConfirmation('导出未填写公司名的文件', `有 ${stats.value.noCompany} 个文件未填公司名，会归到“未命名公司”。`, '仍要导出')) return;
  }
  busy.value = true;
  logs.value = [];
  try {
    const payload = { partitions: store.partitions, files: store.files };
    let res;
    if (supported) {
      log("请选择导出目标文件夹…");
      res = await exportToDirectory(payload, log);
    } else {
      log("当前环境不支持选择文件夹，改为逐个下载（建议用 Chrome / Edge）。");
      res = await exportByDownload(payload, log);
    }
      toast(`已导出 ${res.files} 个文件的整理结果。`, { duration: 6000 });
  } catch (e) {
    if (e && (e.name === "AbortError" || /abort/i.test(e.message || ""))) toastInfo("已取消选择文件夹。");
    else toastError("导出出错：" + ((e && e.message) || e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <footer class="ui-toolbar min-h-11 flex-wrap justify-between gap-2 py-1 text-xs">
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />
    <p class="ui-money text-ink-secondary">{{ stats.partitions }} 个工地 · {{ stats.files }} 个文件 · {{ stats.companies }} 个供应商<span v-if="stats.noCompany" class="ml-2 text-warn">{{ stats.noCompany }} 个未填供应商</span></p>
    <p v-if="busy && logs.length" class="min-w-0 flex-1 truncate text-ink-secondary" role="status" :title="logs.at(-1)">{{ logs.at(-1) }}</p>
    <button class="ui-btn-primary ml-auto" :disabled="busy || !store.files.length" @click="doExport">{{ busy ? '导出中…' : '导出到文件夹' }}</button>
  </footer>
</template>

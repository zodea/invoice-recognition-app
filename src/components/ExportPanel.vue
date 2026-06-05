<script setup>
import { ref, computed } from "vue";
import { store } from "../store";
import { exportToDirectory, exportByDownload, fsAccessSupported } from "../lib/export";

const busy = ref(false);
const logs = ref([]);
const done = ref(false);

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
    window.alert("还没有文件可导出。");
    return;
  }
  if (stats.value.noCompany > 0) {
    if (!window.confirm(`有 ${stats.value.noCompany} 个文件未填公司名，会归到“未命名公司”。仍要导出吗？`)) return;
  }
  busy.value = true;
  done.value = false;
  logs.value = [];
  try {
    const payload = { partitions: store.partitions, files: store.files };
    let res;
    if (supported) {
      log("请选择导出目标文件夹…");
      res = await exportToDirectory(payload, log);
    } else {
      log("当前浏览器不支持选择文件夹，改为逐个下载（建议用 Chrome / Edge）。");
      res = await exportByDownload(payload, log);
    }
    log(`✅ 完成，共导出 ${res.files} 个文件的整理结果。`);
    done.value = true;
  } catch (e) {
    if (e && (e.name === "AbortError" || /abort/i.test(e.message || ""))) log("已取消选择文件夹。");
    else log("❌ 导出出错：" + ((e && e.message) || e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="export">
    <div class="summary">
      <div><b>{{ stats.partitions }}</b> 个分区</div>
      <div><b>{{ stats.files }}</b> 个文件</div>
      <div><b>{{ stats.companies }}</b> 个公司</div>
      <div v-if="stats.noCompany" class="warn">{{ stats.noCompany }} 个未填公司</div>
    </div>
    <button class="export-btn" :disabled="busy || !store.files.length" @click="doExport">
      {{ busy ? "导出中…" : "📁 导出到文件夹" }}
    </button>
    <div class="hint" v-if="!supported">※ 选择文件夹需 Chrome / Edge；当前浏览器将改为逐个下载。</div>
    <div class="logs" v-if="logs.length">
      <div v-for="(l, i) in logs" :key="i" :class="{ strong: l.startsWith('✅') || l.startsWith('❌') }">{{ l }}</div>
    </div>
  </div>
</template>

<style scoped>
.export {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  box-shadow: var(--shadow);
}
.summary {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  color: var(--ink-soft);
  margin-bottom: 10px;
}
.summary b {
  color: var(--ink);
  font-size: 16px;
}
.summary .warn {
  color: var(--warn);
}
.export-btn {
  width: 100%;
  border: none;
  background: var(--brand);
  color: #fff;
  font-size: 16px;
  font-weight: 700;
  padding: 12px;
  border-radius: 8px;
}
.export-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.hint {
  color: var(--ink-soft);
  font-size: 12px;
  margin-top: 6px;
}
.logs {
  margin-top: 10px;
  background: #0b1020;
  color: #cbd5e1;
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
  font-family: ui-monospace, Consolas, monospace;
  max-height: 200px;
  overflow: auto;
}
.logs .strong {
  color: #fff;
  font-weight: 700;
}
</style>

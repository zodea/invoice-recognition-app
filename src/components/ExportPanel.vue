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
      log("当前环境不支持选择文件夹，改为逐个下载（建议用 Chrome / Edge）。");
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
  <div class="panel p-3.5">
    <div class="flex gap-4 flex-wrap text-ink-soft mb-2.5">
      <div><b class="text-ink text-base">{{ stats.partitions }}</b> 个分区</div>
      <div><b class="text-ink text-base">{{ stats.files }}</b> 个文件</div>
      <div><b class="text-ink text-base">{{ stats.companies }}</b> 个公司</div>
      <div v-if="stats.noCompany" class="text-warn">{{ stats.noCompany }} 个未填公司</div>
    </div>
    <button class="w-full border-none bg-brand text-white text-base font-700 p-3 rounded-lg disabled:opacity-50 disabled:cursor-default" :disabled="busy || !store.files.length" @click="doExport">
      {{ busy ? "导出中…" : "📁 导出到文件夹" }}
    </button>
    <div class="text-ink-soft text-xs mt-1.5" v-if="!supported">※ 选择文件夹需 Chrome / Edge / 桌面应用；当前环境将改为逐个下载。</div>
    <div class="mt-2.5 bg-[#0b1020] text-[#cbd5e1] rounded-md p-2.5 text-xs font-mono max-h-50 overflow-auto" v-if="logs.length">
      <div v-for="(l, i) in logs" :key="i" :class="l.startsWith('✅') || l.startsWith('❌') ? 'text-white font-700' : ''">{{ l }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from "vue";
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { store, actions, collectIncomplete, fileIncompleteReasons, partitionName } from "../store";
import { exportToDirectory, exportByDownload, fsAccessSupported } from "../lib/export";
import { toast, toastError, toastInfo } from "../lib/toast";

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

// 导出前「不完善」校验（issue #16）：有不完善单据先弹窗，可仍导出或去完善筛选。
const incompleteList = computed(() => collectIncomplete());
const exportGateOpen = computed({
  get: () => store.exportGateOpen,
  set: (v) => (store.exportGateOpen = v),
});
function onExportClick() {
  if (!store.files.length) { window.alert("还没有文件可导出。"); return; }
  if (incompleteList.value.length) { store.exportGateOpen = true; return; }
  doExport();
}
function proceedExport() { store.exportGateOpen = false; doExport(); }
function goFix() { store.exportGateOpen = false; actions.setIncompleteOnly(true); }

async function doExport() {
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
    done.value = true;
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
  <div class="panel p-3.5">
    <div class="flex gap-4 flex-wrap text-ink-soft mb-2.5">
      <div><b class="text-ink text-base">{{ stats.partitions }}</b> 个分区</div>
      <div><b class="text-ink text-base">{{ stats.files }}</b> 个文件</div>
      <div><b class="text-ink text-base">{{ stats.companies }}</b> 个公司</div>
      <div v-if="stats.noCompany" class="text-warn">{{ stats.noCompany }} 个未填公司</div>
    </div>
    <button class="w-full border-none bg-brand text-white text-base font-700 p-3 rounded-lg disabled:opacity-50 disabled:cursor-default" :disabled="busy || !store.files.length" @click="onExportClick">
      {{ busy ? "导出中…" : "📁 导出到文件夹" }}
    </button>
    <div class="text-ink-soft text-xs mt-1.5" v-if="!supported">※ 选择文件夹需 Chrome / Edge / 桌面应用；当前环境将改为逐个下载。</div>
    <div class="mt-2.5 bg-[#0b1020] text-[#cbd5e1] rounded-md p-2.5 text-xs font-mono max-h-50 overflow-auto" v-if="busy && logs.length">
      <div v-for="(l, i) in logs" :key="i" :class="l.startsWith('✅') || l.startsWith('❌') ? 'text-white font-700' : ''">{{ l }}</div>
    </div>

    <!-- 导出前不完善校验弹窗（issue #16） -->
    <DialogRoot :open="exportGateOpen" @update:open="exportGateOpen = $event">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
        <DialogContent class="fixed z-51 top-[6vh] left-1/2 -translate-x-1/2 w-[min(720px,94vw)] max-h-[86vh] overflow-auto bg-bg rounded-card shadow-pop p-4 outline-none">
          <DialogTitle class="m-0 text-base font-700">导出前检查：{{ incompleteList.length }} 个单据可能不完善</DialogTitle>
          <DialogDescription class="mt-1 text-[13px] text-ink-soft">未识别 / 公司或日期为空 / 缺单号 / 0 明细 / 待复核 等。可仍导出，或先去补完。</DialogDescription>
          <div class="mt-3 flex flex-col gap-1.5">
            <div v-for="f in incompleteList" :key="f.id" class="flex items-start gap-2 px-2 py-1.5 rounded-md bg-white border border-line text-[13px]">
              <span class="flex-none">📄</span>
              <div class="min-w-0 flex-1">
                <div class="font-600 truncate" :title="f.name">{{ f.name }}<span class="text-ink-soft font-400">　{{ partitionName(f.partitionId) }}</span></div>
                <div class="text-[#92400e]">{{ fileIncompleteReasons(f).join("、") }}</div>
              </div>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-end gap-2">
            <button class="btn px-3 py-1.5" @click="proceedExport">仍导出</button>
            <button class="btn-primary px-3 py-1.5" @click="goFix">去完善（筛选未完善）</button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

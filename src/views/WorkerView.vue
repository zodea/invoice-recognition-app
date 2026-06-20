<script setup>
// 工人信息列表（DESIGN-project-worker.md §2.3）：工具栏 + 汇总卡片（在场/已退场/证书即将过期）+ vxe-table。
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useWorkerStore } from "../stores/worker";
import { exportWorkersWorkbookBytes, importWorkersWorkbookBytes } from "../lib/worker-db";
import { normalizeCompanyName } from "../lib/supplier-db";
import { downloadBytes } from "../lib/invoice-layout";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";
import WorkerFormDialog from "../components/WorkerFormDialog.vue";

const router = useRouter();
const workerStore = useWorkerStore();
const query = ref("");
const importInput = ref(null);

const formOpen = ref(false);
const formWorker = ref(null);

const filtered = computed(() => {
  const q = normalizeCompanyName(query.value);
  if (!q) return workerStore.list;
  return workerStore.list.filter((w) => {
    const hay = [w.name, w.trade, w.team, w.currentProject, w.phone].map(normalizeCompanyName).join("|");
    return hay.includes(q);
  });
});

const onSiteCount = computed(() => workerStore.list.filter((w) => w.projectStatus !== "已退场").length);
const offSiteCount = computed(() => workerStore.list.filter((w) => w.projectStatus === "已退场").length);
const expiringCount = computed(() => workerStore.expiringCerts(30).length);

function startAdd() { formWorker.value = null; formOpen.value = true; }
function startEdit(w) { formWorker.value = w; formOpen.value = true; }
function onFormSubmit({ record, isNew, keepOpen }) {
  if (isNew) { workerStore.add(record); toast(`已新增工人：${record.name}`); }
  else { workerStore.update(record); toast(`已保存：${record.name}`); }
  if (!keepOpen) formOpen.value = false;
}
function remove(w) {
  if (!window.confirm(`删除工人「${w.name}」？`)) return;
  workerStore.remove(w.id);
  toastInfo(`已删除：${w.name}`);
}
function openDetail(w) { router.push(`/worker/${w.id}`); }

async function exportExcel() {
  if (!workerStore.list.length) { toastWarn("工人列表为空。"); return; }
  const bytes = exportWorkersWorkbookBytes(workerStore.list);
  const name = "工人信息.xlsx";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) toastInfo("已取消导出。");
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo("已下载工人信息 Excel。"); }
    else toast(`已保存：${r.saved}`);
  } catch (e) {
    downloadBytes(bytes, name, mime);
    toastWarn("保存目录失败，已改为下载。");
  }
}
async function onImportPick(e) {
  const file = Array.from(e.target.files || []).find((f) => /\.(xlsx|xls)$/i.test(f.name));
  e.target.value = "";
  if (!file) { toastWarn("请选择 .xlsx / .xls 文件。"); return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = importWorkersWorkbookBytes(workerStore.list, bytes);
    workerStore.persist();
    toast(`导入完成：读取 ${r.imported} 行，新增 ${r.added} 人，补充 ${r.updated} 人。`);
  } catch (err) {
    toastError("导入失败：" + ((err && err.message) || err));
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <span class="text-sm font-700">工人信息库 · 共 {{ workerStore.list.length }} 人</span>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <label class="relative flex-none">
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 i-lucide-search w-3.5 h-3.5 text-ink-faint"></span>
          <input v-model="query" class="field-input pl-8 pr-3 w-52 py-1.5" placeholder="搜索姓名、工种、班组…" />
        </label>
        <button class="btn-primary px-2.75 py-1.5" @click="startAdd">
          <span class="i-lucide-plus w-4 h-4 flex-none"></span>
          新增
        </button>
        <button class="btn px-2.75 py-1.5" @click="importInput.click()">导入 Excel</button>
        <button class="btn px-2.75 py-1.5" :disabled="!workerStore.list.length" @click="exportExcel">导出 Excel</button>
        <input ref="importInput" type="file" accept=".xlsx,.xls" hidden @change="onImportPick" />
      </div>
    </div>

    <!-- 汇总卡片 -->
    <div class="grid grid-cols-3 lt-md:grid-cols-1 gap-3">
      <div class="panel p-3">
        <div class="text-xs text-ink-soft">在场工人</div>
        <div class="text-2xl font-800 text-brand mt-1">{{ onSiteCount }}</div>
      </div>
      <div class="panel p-3">
        <div class="text-xs text-ink-soft">已退场</div>
        <div class="text-2xl font-800 text-ink-soft mt-1">{{ offSiteCount }}</div>
      </div>
      <div class="panel p-3">
        <div class="text-xs text-ink-soft">证书即将过期（30 天内/已过期）</div>
        <div class="text-2xl font-800 mt-1" :class="expiringCount ? 'text-warn' : 'text-ink'">{{ expiringCount }}</div>
      </div>
    </div>

    <div class="panel p-2">
      <vxe-table
        :data="filtered"
        height="500"
        size="small"
        border
        show-overflow
        :row-config="{ isHover: true }"
        :column-config="{ resizable: true }"
        :empty-text="workerStore.list.length ? '没有匹配的工人。' : '还没有工人。可手动新增，或导入现有 Excel。'"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="姓名" width="80" fixed="left">
          <template #default="{ row }">
            <button class="border-none bg-transparent p-0 text-brand font-600 cursor-pointer hover:underline text-left" title="查看工人详情" @click="openDetail(row)">
              {{ row.name }}
            </button>
          </template>
        </vxe-column>
        <vxe-column field="trade" title="工种" width="80" />
        <vxe-column field="team" title="所属班组" width="90" />
        <vxe-column field="currentProject" title="当前项目" min-width="120" />
        <vxe-column field="projectStatus" title="在场状态" width="80">
          <template #default="{ row }">
            <span :class="row.projectStatus === '已退场' ? 'chip bg-surface-3 text-ink-soft' : 'chip-brand'">{{ row.projectStatus || "在场" }}</span>
          </template>
        </vxe-column>
        <vxe-column field="dailyWage" title="日工资" width="80" align="right">
          <template #default="{ row }">{{ row.dailyWage != null && row.dailyWage !== "" ? "¥" + row.dailyWage : "—" }}</template>
        </vxe-column>
        <vxe-column field="phone" title="联系电话" width="110" />
        <vxe-column title="操作" width="130" fixed="right">
          <template #default="{ row }">
            <div class="flex gap-1.5 items-center">
              <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition" title="详情" @click="openDetail(row)">
                <span class="i-lucide-file-text w-4 h-4"></span>
              </button>
              <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-ink-soft hover:(border-brand text-brand) transition" title="编辑" @click="startEdit(row)">
                <span class="i-lucide-square-pen w-4 h-4"></span>
              </button>
              <button class="inline-flex items-center justify-center w-7 h-7 rounded-btn border border-line bg-white text-danger hover:(border-danger bg-danger/5) transition" title="删除" @click="remove(row)">
                <span class="i-lucide-trash-2 w-4 h-4"></span>
              </button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <WorkerFormDialog v-model:open="formOpen" :worker="formWorker" @submit="onFormSubmit" />
  </div>
</template>

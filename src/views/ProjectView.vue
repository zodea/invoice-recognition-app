<script setup>
// 施工项目列表（DESIGN-project-worker.md §1.3）：工具栏 + vxe-table（固定首列项目名/尾列操作）。
// 新增/编辑走弹窗，详情走路由 /project/:id（沿用分供方模式）。
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";
import {
  projectStatusChip,
  exportProjectsWorkbookBytes,
  importProjectsWorkbookBytes,
} from "../lib/project-db";
import { normalizeCompanyName } from "../lib/supplier-db";
import { downloadBytes } from "../lib/invoice-layout";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";
import ProjectFormDialog from "../components/ProjectFormDialog.vue";

const router = useRouter();
const projectStore = useProjectStore();
const query = ref("");
const importInput = ref(null);

const formOpen = ref(false);
const formProject = ref(null); // null = 新增

const filtered = computed(() => {
  const q = normalizeCompanyName(query.value);
  if (!q) return projectStore.list;
  return projectStore.list.filter((p) => {
    const hay = [p.name, p.address, p.developer, p.manager, p.code].map(normalizeCompanyName).join("|");
    return hay.includes(q);
  });
});

function startAdd() { formProject.value = null; formOpen.value = true; }
function startEdit(p) { formProject.value = p; formOpen.value = true; }
function onFormSubmit({ record, isNew, keepOpen }) {
  const name = (record.name || "").trim();
  const dup = projectStore.findDuplicate(name, record.id);
  if (dup) { toastWarn(`已存在同名项目：${dup.name}`); return; }
  if (isNew) { projectStore.add(record); toast(`已新增项目：${name}`); }
  else { projectStore.update(record); toast(`已保存：${name}`); }
  if (!keepOpen) formOpen.value = false;
}
function remove(p) {
  if (!window.confirm(`删除项目「${p.name}」？不影响已识别的送货单/发票数据。`)) return;
  projectStore.remove(p.id);
  toastInfo(`已删除：${p.name}`);
}
function openDetail(p) { router.push(`/project/${p.id}`); }

async function exportExcel() {
  if (!projectStore.list.length) { toastWarn("施工项目列表为空。"); return; }
  const bytes = exportProjectsWorkbookBytes(projectStore.list);
  const name = "施工项目.xlsx";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) toastInfo("已取消导出。");
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo("已下载施工项目 Excel。"); }
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
    const r = importProjectsWorkbookBytes(projectStore.list, bytes);
    projectStore.persist();
    toast(`导入完成：读取 ${r.imported} 行，新增 ${r.added} 个，补充 ${r.updated} 个。`);
  } catch (err) {
    toastError("导入失败：" + ((err && err.message) || err));
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <span class="text-sm font-700">施工项目 · 共 {{ projectStore.list.length }} 个</span>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <label class="relative flex-none">
          <span class="absolute left-2.5 top-1/2 -translate-y-1/2 i-lucide-search w-3.5 h-3.5 text-ink-faint"></span>
          <input v-model="query" class="field-input pl-8 pr-3 w-52 py-1.5" placeholder="搜索项目名、地址…" />
        </label>
        <button class="btn-primary px-2.75 py-1.5" @click="startAdd">
          <span class="i-lucide-plus w-4 h-4 flex-none"></span>
          新增
        </button>
        <button class="btn px-2.75 py-1.5" @click="importInput.click()">导入 Excel</button>
        <button class="btn px-2.75 py-1.5" :disabled="!projectStore.list.length" @click="exportExcel">导出 Excel</button>
        <input ref="importInput" type="file" accept=".xlsx,.xls" hidden @change="onImportPick" />
      </div>
    </div>

    <div class="panel p-2">
      <vxe-table
        :data="filtered"
        height="560"
        size="small"
        border
        show-overflow
        :row-config="{ isHover: true }"
        :column-config="{ resizable: true }"
        :empty-text="projectStore.list.length ? '没有匹配的项目。' : '还没有施工项目。可手动新增，或导入现有 Excel。'"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="项目名称" min-width="160" fixed="left">
          <template #default="{ row }">
            <button class="border-none bg-transparent p-0 text-brand font-600 cursor-pointer hover:underline text-left" title="查看项目详情" @click="openDetail(row)">
              {{ row.name }}
            </button>
          </template>
        </vxe-column>
        <vxe-column field="status" title="状态" width="90">
          <template #default="{ row }">
            <span :class="projectStatusChip(row.status)">{{ row.status || "—" }}</span>
          </template>
        </vxe-column>
        <vxe-column field="address" title="项目地址" min-width="130" />
        <vxe-column field="startDate" title="开工日期" width="110" />
        <vxe-column field="developer" title="建设单位" min-width="120" />
        <vxe-column field="manager" title="项目经理" width="90" />
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

    <ProjectFormDialog v-model:open="formOpen" :project="formProject" @submit="onFormSubmit" />
  </div>
</template>

<script setup>
// 施工项目详情（路由页 /project/:id，DESIGN-project-worker.md §1.4）：
// 项目信息卡片（只读，右上编辑）+ 费用概览 + 关联分供方（识别明细库按 site 匹配）+ 在场工人（工人库按 currentProject）。
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";
import { useWorkerStore } from "../stores/worker";
import { useSupplierStore } from "../stores/supplier";
import { useRecognizedStore } from "../stores/recognized";
import { projectStatusChip, projectMatchesSite } from "../lib/project-db";
import { matchSupplier } from "../lib/supplier-db";
import { toast } from "../lib/toast";
import ProjectFormDialog from "../components/ProjectFormDialog.vue";

const route = useRoute();
const router = useRouter();
const projectStore = useProjectStore();
const workerStore = useWorkerStore();
const supplierStore = useSupplierStore();
const recognized = useRecognizedStore();
onMounted(() => recognized.ensureLoaded());

const project = computed(() => projectStore.byId(route.params.id));
const formOpen = ref(false);

function onFormSubmit({ record }) {
  const dup = projectStore.findDuplicate(record.name, record.id);
  if (dup) { toast(`已存在同名项目：${dup.name}`); return; }
  projectStore.update(record);
  formOpen.value = false;
  toast("已保存项目信息。");
}

// 识别明细库里属于本项目的记录（site 模糊匹配项目名）。
const recs = computed(() => {
  if (!project.value) return [];
  return recognized.allRecords().filter((r) => projectMatchesSite(project.value, r.site));
});

// 关联分供方：本项目送过货的公司，按公司名归并，并尝试关联到分供方库。
const linkedSuppliers = computed(() => {
  const map = new Map(); // company -> { company, amount, fileCount, supplier }
  for (const r of recs.value) {
    const company = (r.company || "").trim();
    if (!company) continue;
    if (!map.has(company)) {
      const hit = matchSupplier(supplierStore.list, company);
      map.set(company, { company, amount: 0, fileCount: 0, supplier: hit?.supplier || null });
    }
    const e = map.get(company);
    e.fileCount++;
    for (const it of r.items || []) e.amount += Number(it.total) || 0;
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
});

// 在场工人：工人库 currentProject 匹配本项目名。
const workers = computed(() => (project.value ? workerStore.byProject(project.value.name) : []));
const onSiteWorkers = computed(() => workers.value.filter((w) => w.projectStatus !== "已退场"));

// 费用概览。
const deliveryTotal = computed(() => Math.round(recs.value.reduce((s, r) => s + (r.items || []).reduce((a, it) => a + (Number(it.total) || 0), 0), 0) * 100) / 100);
const purchaseTotal = computed(() => {
  if (!project.value) return 0;
  let total = 0;
  for (const sup of supplierStore.list) {
    for (const p of sup.purchases || []) {
      if (projectMatchesSite(project.value, p.site)) total += Number(p.total) || 0;
    }
  }
  return Math.round(total * 100) / 100;
});

const money = (v) => (Number(v) || 0).toFixed(2);

// 项目信息卡片字段（只读展示）。
const infoRows = computed(() => {
  const p = project.value || {};
  return [
    ["项目编号", p.code], ["项目类型", p.type], ["项目地址", p.address],
    ["建筑面积", p.area != null ? `${p.area} m²` : ""], ["合同金额", p.contractAmount != null ? `${p.contractAmount} 万元` : ""],
    ["开工日期", p.startDate], ["计划竣工", p.plannedEnd], ["实际竣工", p.actualEnd],
    ["建设单位", p.developer], ["监理单位", p.supervisor], ["设计单位", p.designer], ["总包单位", p.contractor],
    ["项目经理", [p.manager, p.managerPhone].filter(Boolean).join(" / ")],
    ["现场负责人", [p.siteLeader, p.siteLeaderPhone].filter(Boolean).join(" / ")],
    ["备注", p.note],
  ];
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <button class="btn px-2.5 py-1.5" @click="router.push('/project')">
        <span class="i-lucide-arrow-left w-4 h-4 flex-none"></span>
        返回
      </button>
      <h2 class="m-0 text-base font-800">{{ project?.name || "项目详情" }}</h2>
      <span v-if="project" :class="projectStatusChip(project.status)">{{ project.status }}</span>
      <button v-if="project" class="btn-primary px-2.5 py-1.5 ml-auto" @click="formOpen = true">
        <span class="i-lucide-square-pen w-4 h-4 flex-none"></span>
        编辑
      </button>
    </div>

    <div v-if="!project" class="panel p-6 text-center text-ink-soft">未找到该项目，可能已被删除。<button class="btn px-2.5 py-1 ml-2" @click="router.push('/project')">返回列表</button></div>

    <template v-else>
      <!-- 费用概览 -->
      <div class="grid grid-cols-3 lt-md:grid-cols-1 gap-3">
        <div class="panel p-3">
          <div class="text-xs text-ink-soft">材料送货总额（识别明细库）</div>
          <div class="text-xl font-800 text-ink mt-1">¥{{ money(deliveryTotal) }}</div>
        </div>
        <div class="panel p-3">
          <div class="text-xs text-ink-soft">手记采购总额（分供方记录）</div>
          <div class="text-xl font-800 text-ink mt-1">¥{{ money(purchaseTotal) }}</div>
        </div>
        <div class="panel p-3">
          <div class="text-xs text-ink-soft">在场工人</div>
          <div class="text-xl font-800 text-brand mt-1">{{ onSiteWorkers.length }} <span class="text-sm text-ink-soft font-600">/ {{ workers.length }} 人</span></div>
        </div>
      </div>

      <!-- 项目信息卡片 -->
      <div class="panel p-3">
        <h3 class="m-0 mb-3 text-sm font-700">项目信息</h3>
        <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-8 gap-y-2">
          <div v-for="[label, val] in infoRows" :key="label" class="flex gap-3 text-sm border-b border-line/60 py-1.5">
            <span class="text-ink-soft w-24 flex-none">{{ label }}</span>
            <span class="text-ink min-w-0 break-all">{{ val || "—" }}</span>
          </div>
        </div>
      </div>

      <!-- 关联分供方 -->
      <div class="panel p-3">
        <h3 class="m-0 mb-2 text-sm font-700">关联分供方（来自识别明细库，按工地匹配）</h3>
        <div v-if="linkedSuppliers.length" class="flex flex-col gap-1.5">
          <div v-for="s in linkedSuppliers" :key="s.company" class="flex items-center gap-2 border border-line rounded-md px-2.5 py-1.5 bg-white text-sm">
            <button v-if="s.supplier" class="border-none bg-transparent p-0 text-brand font-600 cursor-pointer hover:underline" @click="router.push(`/supplier/${s.supplier.id}`)">{{ s.company }}</button>
            <span v-else class="text-ink font-600">{{ s.company }}</span>
            <span v-if="!s.supplier" class="text-ink-faint text-xs">（未建档）</span>
            <span class="ml-auto text-ink-soft text-xs">{{ s.fileCount }} 份 · ¥{{ money(s.amount) }}</span>
          </div>
        </div>
        <div v-else class="text-ink-soft text-xs">暂无。到「送货单整理」识别并保存该项目的送货单后，这里自动汇总分供方。</div>
      </div>

      <!-- 在场工人 -->
      <div class="panel p-3">
        <div class="flex items-center gap-2 mb-2">
          <h3 class="m-0 text-sm font-700">在场工人花名册</h3>
          <span class="text-ink-soft text-xs">（工人库当前项目 = 本项目）</span>
        </div>
        <div v-if="workers.length" class="flex gap-2 flex-wrap">
          <button v-for="w in workers" :key="w.id"
            class="chip border border-line bg-white px-2.5 py-1 cursor-pointer hover:border-brand"
            :class="w.projectStatus === '已退场' ? 'text-ink-faint' : 'text-ink'"
            @click="router.push(`/worker/${w.id}`)">
            {{ w.name }} · {{ w.trade || "工种?" }}<span v-if="w.projectStatus === '已退场'"> · 已退场</span>
          </button>
        </div>
        <div v-else class="text-ink-soft text-xs">暂无。到「工人信息」把工人的「当前项目」设为本项目即可关联。</div>
      </div>
    </template>

    <ProjectFormDialog v-if="project" v-model:open="formOpen" :project="project" @submit="onFormSubmit" />
  </div>
</template>

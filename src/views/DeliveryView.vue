<script setup>
import { computed, ref, watch } from 'vue';
import { DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose,
  PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui';
import { store, actions, collectProblems } from '../store.js';
import UploadZone from '../components/UploadZone.vue';
import ProjectSidebar from '../components/ProjectSidebar.vue';
import FileCard from '../components/FileCard.vue';
import ExportPanel from '../components/ExportPanel.vue';
import DeliveryTree from '../components/DeliveryTree.vue';
import ProblemDialog from '../components/ProblemDialog.vue';
import MiddleEllipsis from '../components/MiddleEllipsis.vue';

const partitionFiles = computed(() => store.activePartitionId === 'all' ? store.files : store.files.filter(file => file.partitionId === store.activePartitionId));
const supplier = ref('');
const suppliers = computed(() => [...new Set(partitionFiles.value.map(file => file.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')));
watch(suppliers, values => { if (supplier.value && !values.includes(supplier.value)) supplier.value = ''; });
watch(() => store.activePartitionId, () => { supplier.value = ''; });
const visibleFiles = computed(() => supplier.value ? partitionFiles.value.filter(file => file.company === supplier.value) : partitionFiles.value);
const problemCount = computed(() => collectProblems().total);
const selectedFileId = ref(''), collapsed = ref(false), projectsCollapsed = ref(false);
const selectedFile = computed(() => visibleFiles.value.find(file => file.id === selectedFileId.value) || visibleFiles.value[0]);
watch(selectedFile, file => { selectedFileId.value = file?.id || ''; });
const pending = computed(() => store.files.filter(file => file.ocrStatus !== 'done').length);
function status(file) {
  if (file.rendering) return { label: '读取中', tone: 'ui-badge-neutral' };
  if (file.ocrStatus === 'error') return { label: '识别失败', tone: 'ui-badge-danger' };
  if (file.ocrStatus === 'running') return { label: '识别中', tone: 'ui-badge-brand' };
  if (file.companyConflict || file.ocrPartial || file.renderError) return { label: '待核对', tone: 'ui-badge-warn' };
  return file.ocrStatus === 'done' ? { label: '已识别', tone: 'ui-badge-ok' } : { label: '待识别', tone: 'ui-badge-neutral' };
}
</script>

<template>
  <section class="flex min-w-0 flex-col gap-2.5" aria-label="送货单整理">
    <header v-if="!store.staging" class="ui-toolbar min-h-11 flex-wrap gap-2 py-1">
      <h1 class="whitespace-nowrap text-sm font-semibold">送货单整理</h1>
      <UploadZone compact />
      <button type="button" class="ui-btn" :disabled="!pending || store.ocrBusy" @click="actions.runOcrAll">识别全部未识别（{{ pending }}）</button>
      <button type="button" class="ui-btn" :disabled="!store.files.length || store.ocrBusy" @click="actions.stageFromStore()">重新整理</button>
      <DialogRoot>
        <DialogTrigger class="ui-btn">管理工地</DialogTrigger>
        <DialogPortal>
          <DialogOverlay class="ui-overlay z-45" />
          <DialogContent class="ui-dialog z-46 w-[min(420px,94vw)] max-h-[85vh] p-3">
            <header class="mb-2 flex items-center justify-between"><DialogTitle class="text-sm font-semibold">管理项目分区</DialogTitle><DialogClose class="ui-btn">关闭</DialogClose></header>
            <DialogDescription class="sr-only">新增、重命名或移除工地分区。</DialogDescription>
            <ProjectSidebar v-model:collapsed="projectsCollapsed" />
          </DialogContent>
        </DialogPortal>
      </DialogRoot>
      <button v-if="problemCount" type="button" class="ui-btn text-warn" @click="store.problemsOpen = true">问题（{{ problemCount }}）</button>
      <PopoverRoot>
        <PopoverTrigger class="ui-btn ml-auto" aria-label="送货单整理帮助">?</PopoverTrigger>
        <PopoverPortal><PopoverContent class="ui-popover z-45 w-[min(370px,94vw)]" :side-offset="6" align="end">
          <h2 class="mb-2 text-sm font-semibold">送货单整理</h2>
          <ul class="list-disc grid gap-1.5 pl-4 text-xs leading-relaxed text-ink-secondary">
            <li>选择或拖入 PDF、图片和文件夹。文件夹可在整理树中按工地与供应商整理。</li>
            <li>按红章核对供应商，通过单据抬头选择归属工地。原图支持拖动和 Ctrl + 滚轮缩放。</li>
            <li>勾选同公司合并后导出同工地、同供应商的合并 PDF。导出同时生成汇总 Excel。</li>
          </ul>
        </PopoverContent></PopoverPortal>
      </PopoverRoot>
    </header>
    <p v-if="store.ocrMsg && !store.staging" class="px-1 text-xs text-ink-secondary" role="status">{{ store.ocrMsg }}</p>
    <DeliveryTree />
    <template v-if="!store.staging">
      <div v-if="store.files.length" class="delivery-review-grid" :class="{ 'delivery-list-closed': collapsed }">
        <aside class="ui-panel delivery-file-list flex min-h-0 flex-col overflow-hidden" aria-label="送货单文件栏">
          <header class="ui-section-header px-2">
            <h2 v-if="!collapsed" class="whitespace-nowrap text-xs font-semibold">送货单列表（{{ visibleFiles.length }}）</h2>
            <button type="button" class="ui-btn-sm" :aria-label="collapsed ? '展开送货单列表' : '收起送货单列表'" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? '›' : '‹' }}</button>
          </header>
          <template v-if="!collapsed">
            <div class="grid grid-cols-2 gap-1.5 border-b border-line px-2 py-2">
              <select :value="store.activePartitionId" class="ui-input" aria-label="筛选工地" @change="actions.setActivePartition($event.target.value)">
                <option value="all">全部工地</option><option v-for="part in store.partitions" :key="part.id" :value="part.id">{{ part.name }}</option>
              </select>
              <select v-model="supplier" class="ui-input" aria-label="筛选供应商">
                <option value="">全部供应商</option><option v-for="name in suppliers" :key="name">{{ name }}</option>
              </select>
            </div>
            <div class="min-h-0 flex-1 overflow-auto p-1.5">
              <button v-for="file in visibleFiles" :key="file.id" type="button" class="ui-focus grid w-full min-w-0 gap-1 rounded-md border border-transparent px-2 py-1.5 text-left hover:bg-surface"
                :class="{ '!border-brand/30 bg-brand-soft': selectedFile?.id === file.id }" :aria-pressed="selectedFile?.id === file.id" @click="selectedFileId = file.id">
                <strong class="min-w-0 text-xs font-semibold"><MiddleEllipsis :text="file.company || '未填写供应商'" /></strong>
                <span class="flex min-w-0 items-center gap-1.5"><MiddleEllipsis :text="file.name" class="min-w-0 flex-1 text-xs text-ink-secondary" /><span :class="status(file).tone">{{ status(file).label }}</span></span>
              </button>
              <p v-if="!visibleFiles.length" class="px-2 py-3 text-xs text-ink-soft">没有符合筛选的文件</p>
            </div>
          </template>
        </aside>
        <FileCard v-if="selectedFile" :key="selectedFile.id" :file="selectedFile" />
        <div v-else class="ui-panel grid min-h-45 place-items-center text-sm text-ink-secondary">没有符合筛选的文件</div>
      </div>
      <UploadZone v-else />
      <ExportPanel />
    </template>
    <ProblemDialog />
  </section>
</template>

<style scoped>
.delivery-review-grid { display:grid; grid-template-columns:235px minmax(0,1fr); gap:8px; }
.delivery-review-grid.delivery-list-closed { grid-template-columns:48px minmax(0,1fr); }
.delivery-file-list { max-height:max(545px,calc(100dvh - 130px)); }
@media(max-width:760px) {
  .delivery-review-grid,.delivery-review-grid.delivery-list-closed { grid-template-columns:minmax(0,1fr); }
  .delivery-file-list { max-height:280px; }
}
</style>

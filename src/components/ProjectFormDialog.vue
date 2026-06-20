<script setup>
// 新增/编辑施工项目弹窗（DESIGN-project-worker.md §1.2）：分组 + 两列，reka-ui Dialog。
// 沿用 SupplierFormDialog 的排版与交互，无附件区。
import { reactive, ref, computed, watch } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { emptyProject, PROJECT_TYPES, PROJECT_STATUS } from "../lib/project-db";
import { toastWarn } from "../lib/toast";

const props = defineProps({
  open: Boolean,
  project: { type: Object, default: null }, // null = 新增
});
const emit = defineEmits(["update:open", "submit"]);

const draft = reactive(emptyProject());
const isNew = computed(() => !props.project);

function resetDraft() {
  Object.assign(draft, emptyProject(), props.project ? JSON.parse(JSON.stringify(props.project)) : {});
}
watch(() => props.open, (v) => { if (v) resetDraft(); });

function buildRecord() {
  const r = JSON.parse(JSON.stringify(draft));
  r.name = (draft.name || "").trim();
  r.area = draft.area === "" || draft.area == null ? null : Number(draft.area);
  r.contractAmount = draft.contractAmount === "" || draft.contractAmount == null ? null : Number(draft.contractAmount);
  return r;
}
function submit(keepOpen) {
  if ((draft.name || "").trim().length < 2) { toastWarn("项目名称至少 2 个字。"); return; }
  emit("submit", { record: buildRecord(), isNew: isNew.value, keepOpen });
  if (keepOpen) Object.assign(draft, emptyProject());
}

const fi = "field-input";
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent class="fixed z-51 top-[6vh] left-1/2 -translate-x-1/2 w-[min(880px,95vw)] max-h-[88vh] overflow-auto bg-bg rounded-card shadow-pop outline-none">
        <div class="sticky top-0 z-2 flex items-center gap-2 px-4 py-3 bg-bg border-b border-line">
          <DialogTitle class="m-0 text-base font-700">{{ isNew ? "新增施工项目" : "编辑施工项目" }}</DialogTitle>
          <DialogClose class="ml-auto btn px-2.5 py-1">关闭 ✕</DialogClose>
        </div>

        <div class="p-4 flex flex-col gap-3">
          <!-- 基本信息 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">基本信息</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label col-span-2">项目名称 <span class="text-danger">*</span><input :class="fi" v-model="draft.name" placeholder="如：碧桂园·凤凰城三期" /></label>
              <label class="field-label">项目编号<input :class="fi" v-model="draft.code" placeholder="内部编号" /></label>
              <label class="field-label">项目类型
                <select :class="fi" v-model="draft.type">
                  <option value="">（未选）</option>
                  <option v-for="t in PROJECT_TYPES" :key="t" :value="t">{{ t }}</option>
                </select>
              </label>
              <label class="field-label col-span-2">项目地址<input :class="fi" v-model="draft.address" placeholder="施工现场地址" /></label>
              <label class="field-label">建筑面积（m²）<input :class="fi" v-model="draft.area" inputmode="decimal" /></label>
              <label class="field-label">合同金额（万元）<input :class="fi" v-model="draft.contractAmount" inputmode="decimal" /></label>
            </div>
          </section>

          <!-- 工期进度 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">工期进度</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">开工日期<input :class="fi" type="date" v-model="draft.startDate" /></label>
              <label class="field-label">计划竣工日期<input :class="fi" type="date" v-model="draft.plannedEnd" /></label>
              <label class="field-label">实际竣工日期<input :class="fi" type="date" v-model="draft.actualEnd" /></label>
              <label class="field-label">当前状态
                <select :class="fi" v-model="draft.status">
                  <option v-for="s in PROJECT_STATUS" :key="s" :value="s">{{ s }}</option>
                </select>
              </label>
            </div>
          </section>

          <!-- 参建单位 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">参建单位</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">建设单位（甲方/业主）<input :class="fi" v-model="draft.developer" /></label>
              <label class="field-label">监理单位<input :class="fi" v-model="draft.supervisor" /></label>
              <label class="field-label">设计单位<input :class="fi" v-model="draft.designer" /></label>
              <label class="field-label">总包单位<input :class="fi" v-model="draft.contractor" /></label>
            </div>
          </section>

          <!-- 管理人员 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">管理人员</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">项目经理<input :class="fi" v-model="draft.manager" /></label>
              <label class="field-label">项目经理电话<input :class="fi" v-model="draft.managerPhone" inputmode="tel" /></label>
              <label class="field-label">现场负责人<input :class="fi" v-model="draft.siteLeader" /></label>
              <label class="field-label">现场负责人电话<input :class="fi" v-model="draft.siteLeaderPhone" inputmode="tel" /></label>
              <label class="field-label col-span-2">备注<input :class="fi" v-model="draft.note" /></label>
            </div>
          </section>
        </div>

        <div class="sticky bottom-0 z-2 flex items-center gap-2 px-4 py-3 bg-bg border-t border-line">
          <button class="btn-primary px-3.5 py-1.5" @click="submit(false)">保存</button>
          <button v-if="isNew" class="btn px-3.5 py-1.5" @click="submit(true)">保存并继续新增</button>
          <DialogClose class="btn px-3.5 py-1.5 ml-auto">取消</DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

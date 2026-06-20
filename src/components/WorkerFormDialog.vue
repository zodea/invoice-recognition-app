<script setup>
// 新增/编辑工人弹窗（DESIGN-project-worker.md §2.2）：分组 + 两列 + 证书档案卡片。
// 证书文件落盘属后端阶段——此处先存元数据（类别/子类型/有效期/文件名）+ 本会话预览（object URL）。
import { reactive, ref, computed, watch } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { emptyWorker, emptyCert, TRADES, SKILL_LEVELS, PROJECT_STATUS, CERT_CATEGORIES, certExpiryStatus, certStatusClass, certStatusLabel } from "../lib/worker-db";
import { useProjectStore } from "../stores/project";
import { toastWarn } from "../lib/toast";

const props = defineProps({
  open: Boolean,
  worker: { type: Object, default: null }, // null = 新增
});
const emit = defineEmits(["update:open", "submit"]);

const projectStore = useProjectStore();
const draft = reactive(emptyWorker());
const isNew = computed(() => !props.worker);

function resetDraft() {
  Object.assign(draft, emptyWorker(), props.worker ? JSON.parse(JSON.stringify(props.worker)) : {});
  if (!Array.isArray(draft.certs)) draft.certs = [];
}
watch(() => props.open, (v) => { if (v) resetDraft(); });

function onUploadCert(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  for (const file of files) {
    if (!/\.(png|jpe?g|bmp|webp|gif|tiff?|pdf)$/i.test(file.name)) {
      toastWarn(`不支持的类型：${file.name}（仅图片 / PDF）`);
      continue;
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const cert = emptyCert();
    cert.category = classifyCert(file.name);
    cert.fileName = file.name;
    cert.ext = ext;
    cert.addedAt = new Date().toISOString().slice(0, 10);
    cert._url = URL.createObjectURL(file); // 本会话预览
    cert._file = file;
    draft.certs.push(cert);
  }
}
function classifyCert(name) {
  const n = String(name || "");
  if (/身份证/.test(n)) return "身份证";
  if (/安全|三级|教育/.test(n)) return "安全培训合格证";
  if (/特种|操作证|电工证|焊工证|高处|登高|起重/.test(n)) return "特种作业操作证";
  return "其他";
}
function addBlankCert() {
  const c = emptyCert();
  c.addedAt = new Date().toISOString().slice(0, 10);
  draft.certs.push(c);
}
function viewCert(cert) {
  if (cert._url) window.open(cert._url, "_blank", "noopener");
  else toastWarn("该证书暂无可预览的文件（文件落盘待后端接入）。");
}
function removeCert(cert) {
  if (cert._url) URL.revokeObjectURL(cert._url);
  const i = draft.certs.findIndex((c) => c.id === cert.id);
  if (i >= 0) draft.certs.splice(i, 1);
}

function buildRecord() {
  const certs = (draft.certs || []).map((c) => ({
    id: c.id, category: c.category, subType: c.subType || "", fileName: c.fileName || "",
    relPath: c.relPath || "", ext: c.ext || "", expiryDate: c.expiryDate || "", addedAt: c.addedAt || "",
  })); // 去掉 _url/_file 瞬时字段
  const r = JSON.parse(JSON.stringify({ ...draft, certs: [] }));
  r.certs = certs;
  r.name = (draft.name || "").trim();
  r.dailyWage = draft.dailyWage === "" || draft.dailyWage == null ? null : Number(draft.dailyWage);
  return r;
}
function submit(keepOpen) {
  if ((draft.name || "").trim().length < 2) { toastWarn("姓名至少 2 个字。"); return; }
  if (!(draft.phone || "").trim()) { toastWarn("请填写联系电话。"); return; }
  if (!(draft.trade || "").trim()) { toastWarn("请选择工种。"); return; }
  emit("submit", { record: buildRecord(), isNew: isNew.value, keepOpen });
  if (keepOpen) { for (const c of draft.certs || []) if (c._url) URL.revokeObjectURL(c._url); Object.assign(draft, emptyWorker()); }
}

const fi = "field-input";
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent class="fixed z-51 top-[6vh] left-1/2 -translate-x-1/2 w-[min(880px,95vw)] max-h-[88vh] overflow-auto bg-bg rounded-card shadow-pop outline-none">
        <div class="sticky top-0 z-2 flex items-center gap-2 px-4 py-3 bg-bg border-b border-line">
          <DialogTitle class="m-0 text-base font-700">{{ isNew ? "新增工人" : "编辑工人" }}</DialogTitle>
          <DialogClose class="ml-auto btn px-2.5 py-1">关闭 ✕</DialogClose>
        </div>

        <div class="p-4 flex flex-col gap-3">
          <!-- 个人信息 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">个人信息</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">姓名 <span class="text-danger">*</span><input :class="fi" v-model="draft.name" /></label>
              <label class="field-label">性别
                <select :class="fi" v-model="draft.gender"><option value="">（未选）</option><option>男</option><option>女</option></select>
              </label>
              <label class="field-label col-span-2">身份证号<input :class="fi" v-model="draft.idCard" maxlength="18" /></label>
              <label class="field-label">联系电话 <span class="text-danger">*</span><input :class="fi" v-model="draft.phone" inputmode="tel" /></label>
              <label class="field-label">籍贯<input :class="fi" v-model="draft.hometown" placeholder="省/市" /></label>
              <label class="field-label">紧急联系人<input :class="fi" v-model="draft.emergencyContact" /></label>
              <label class="field-label">紧急联系电话<input :class="fi" v-model="draft.emergencyPhone" inputmode="tel" /></label>
            </div>
          </section>

          <!-- 工作信息 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">工作信息</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">工种 <span class="text-danger">*</span>
                <select :class="fi" v-model="draft.trade"><option value="">（未选）</option><option v-for="t in TRADES" :key="t" :value="t">{{ t }}</option></select>
              </label>
              <label class="field-label">技能等级
                <select :class="fi" v-model="draft.skillLevel"><option value="">（未选）</option><option v-for="s in SKILL_LEVELS" :key="s" :value="s">{{ s }}</option></select>
              </label>
              <label class="field-label">日工资（元）<input :class="fi" v-model="draft.dailyWage" inputmode="decimal" /></label>
              <label class="field-label">所属班组<input :class="fi" v-model="draft.team" /></label>
            </div>
          </section>

          <!-- 项目分配 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">项目分配</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">当前项目
                <input :class="fi" v-model="draft.currentProject" list="project-options" placeholder="关联施工项目（可手填）" />
                <datalist id="project-options"><option v-for="p in projectStore.list" :key="p.id" :value="p.name" /></datalist>
              </label>
              <label class="field-label">在场状态
                <select :class="fi" v-model="draft.projectStatus"><option v-for="s in PROJECT_STATUS" :key="s" :value="s">{{ s }}</option></select>
              </label>
              <label class="field-label">进场日期<input :class="fi" type="date" v-model="draft.entryDate" /></label>
              <label class="field-label">退场日期<input :class="fi" type="date" v-model="draft.exitDate" /></label>
            </div>
          </section>

          <!-- 证书档案 -->
          <section class="panel p-3">
            <div class="flex items-center gap-2 mb-2.5 flex-wrap">
              <h3 class="m-0 text-sm font-700 text-brand">证书档案</h3>
              <span class="text-ink-soft text-xs">身份证 / 安全培训合格证 / 特种作业操作证（带有效期，图片 / PDF）</span>
              <div class="ml-auto flex gap-2">
                <button class="btn px-2.5 py-1.25 text-xs" @click="addBlankCert">＋ 手填一条</button>
                <label class="btn-primary px-2.5 py-1.25 text-xs cursor-pointer">
                  ＋ 上传证书
                  <input type="file" multiple accept="image/*,.pdf" hidden @change="onUploadCert" />
                </label>
              </div>
            </div>
            <div v-if="!draft.certs.length" class="text-ink-soft text-xs text-center border border-dashed border-line-strong rounded-md py-4">
              还没有证书。上传文件会按文件名自动归类（可手改类别），并可填写有效期用于到期预警。
            </div>
            <div v-else class="flex flex-col gap-1.5">
              <div v-for="cert in draft.certs" :key="cert.id" class="flex items-center gap-2 border border-line rounded-md px-2.5 py-1.5 bg-white flex-wrap">
                <select v-model="cert.category" class="field-input w-32 py-1 text-xs shrink-0">
                  <option v-for="c in CERT_CATEGORIES" :key="c" :value="c">{{ c }}</option>
                </select>
                <input v-model="cert.subType" class="field-input w-28 py-1 text-xs shrink-0" placeholder="子类型(电工/高处…)" />
                <span class="min-w-0 flex-1 truncate text-xs text-ink" :title="cert.fileName">{{ cert.fileName || "（未上传文件）" }}</span>
                <label class="text-xs text-ink-soft shrink-0 flex items-center gap-1">有效期
                  <input v-model="cert.expiryDate" type="date" class="field-input w-34 py-1 text-xs" />
                </label>
                <span :class="certStatusClass(certExpiryStatus(cert.expiryDate))" class="shrink-0">{{ certStatusLabel(certExpiryStatus(cert.expiryDate)) }}</span>
                <button class="btn px-2 py-0.75 text-xs shrink-0" @click="viewCert(cert)">查看</button>
                <button class="btn-danger px-2 py-0.75 text-xs shrink-0" @click="removeCert(cert)">删除</button>
              </div>
            </div>
          </section>

          <!-- 备注 -->
          <section class="panel p-3">
            <label class="field-label">备注<input :class="fi" v-model="draft.note" /></label>
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

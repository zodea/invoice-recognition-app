<script setup>
// 新增/编辑分供方弹窗（issue #12 / ADR-0002）：参照 送货单/分供方-1·2 的「分组 + 两列」排版，
// 用 reka-ui Dialog（弹窗），不再内联 div 触发列表重排。附件区：上传 → 自动归类(文件名，OCR 内容见后续)
// → 当前界面预览；落盘(Tauri)与内容回填在后续步骤接入。
import { reactive, ref, computed, watch } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { emptySupplier, ATTACHMENT_CATEGORIES } from "../lib/supplier-db";
import { toastWarn } from "../lib/toast";

const props = defineProps({
  open: Boolean,
  supplier: { type: Object, default: null }, // null = 新增
});
const emit = defineEmits(["update:open", "submit"]);

let seq = 0;
const auid = () => `att_${Date.now().toString(36)}_${(seq++).toString(36)}`;

const draft = reactive(emptySupplier());
const aliasesText = ref("");
const isNew = computed(() => !props.supplier);

function resetDraft() {
  Object.assign(draft, emptySupplier(), props.supplier ? JSON.parse(JSON.stringify(props.supplier)) : {});
  if (!Array.isArray(draft.attachments)) draft.attachments = [];
  aliasesText.value = (draft.aliases || []).join("、");
}
watch(() => props.open, (v) => { if (v) resetDraft(); });

// 文件名关键词归类（L1）；OCR 内容归类+回填在后续步骤接入。
function classifyByName(name) {
  const n = String(name || "");
  if (/营业执照/.test(n)) return "营业执照";
  if (/开户许可|基本存款|开户证实/.test(n)) return "银行开户许可证";
  if (/(法人|法定代表).*身份证/.test(n)) return "法人身份证";
  if (/(签约|代表).*身份证/.test(n)) return "签约代表身份证";
  if (/身份证/.test(n)) return "法人身份证";
  if (/授权/.test(n)) return "品牌授权证明";
  return "其他";
}

function onUpload(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  for (const file of files) {
    if (!/\.(png|jpe?g|bmp|webp|gif|tiff?|pdf)$/i.test(file.name)) {
      toastWarn(`不支持的类型：${file.name}（仅图片 / PDF）`);
      continue;
    }
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    draft.attachments.push({
      id: auid(),
      category: classifyByName(file.name),
      fileName: file.name,
      ext,
      relPath: "", // 落盘后填（Tauri）
      addedAt: new Date().toISOString().slice(0, 10),
      _url: URL.createObjectURL(file), // 仅当前界面预览，不持久化
      _isImg: file.type.startsWith("image/"),
    });
  }
}
function viewAttachment(att) {
  if (att._url) window.open(att._url, "_blank", "noopener");
  else toastWarn("该附件在本机未保存预览（桌面端落盘后可打开）。");
}
function removeAttachment(att) {
  if (att._url) URL.revokeObjectURL(att._url);
  const i = draft.attachments.findIndex((a) => a.id === att.id);
  if (i >= 0) draft.attachments.splice(i, 1);
}

function buildRecord() {
  const aliases = String(aliasesText.value || "").split(/[、,，;；/]+/).map((x) => x.trim()).filter(Boolean);
  const attachments = (draft.attachments || []).map((a) => ({
    id: a.id, category: a.category, fileName: a.fileName, ext: a.ext, relPath: a.relPath || "", addedAt: a.addedAt || "",
  })); // 去掉 _url/_isImg 等瞬时字段，不写进 localStorage
  return { ...JSON.parse(JSON.stringify({ ...draft, attachments: [] })), aliases, attachments, name: (draft.name || "").trim() };
}

function submit(keepOpen) {
  if ((draft.name || "").trim().length < 2) { toastWarn("公司全称至少 2 个字。"); return; }
  emit("submit", { record: buildRecord(), isNew: isNew.value, keepOpen });
  if (keepOpen) resetDraftNew();
}
function resetDraftNew() {
  for (const a of draft.attachments || []) if (a._url) URL.revokeObjectURL(a._url);
  Object.assign(draft, emptySupplier());
  aliasesText.value = "";
}

const fi = "field-input";
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent class="fixed z-51 top-[6vh] left-1/2 -translate-x-1/2 w-[min(880px,95vw)] max-h-[88vh] overflow-auto bg-bg rounded-card shadow-pop outline-none">
        <div class="sticky top-0 z-2 flex items-center gap-2 px-4 py-3 bg-bg border-b border-line">
          <DialogTitle class="m-0 text-base font-700">{{ isNew ? "新增分供方" : "编辑分供方" }}</DialogTitle>
          <DialogClose class="ml-auto btn px-2.5 py-1">关闭 ✕</DialogClose>
        </div>

        <div class="p-4 flex flex-col gap-3">
          <!-- 基础信息 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">基础信息</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label col-span-2">公司全称 <span class="text-danger">*</span><input :class="fi" v-model="draft.name" placeholder="如：广州市大板东建材有限公司" /></label>
              <label class="field-label col-span-2">简称 / 别名（顿号分隔，用于文件夹名对应）<input :class="fi" v-model="aliasesText" placeholder="如：大板东、大板东建材" /></label>
              <label class="field-label">公司税号（统一社会信用代码）<input :class="fi" v-model="draft.taxNo" /></label>
              <label class="field-label">法人（法定代表人）<input :class="fi" v-model="draft.legalRep" /></label>
              <label class="field-label col-span-2">注册地址<input :class="fi" v-model="draft.address" /></label>
            </div>
          </section>

          <!-- 开票信息 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">开票信息</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">开户行<input :class="fi" v-model="draft.bank" /></label>
              <label class="field-label">银行账号<input :class="fi" v-model="draft.bankAccount" /></label>
            </div>
          </section>

          <!-- 联系人信息 -->
          <section class="panel p-3">
            <h3 class="m-0 mb-2.5 text-sm font-700 text-brand">联系人信息</h3>
            <div class="grid grid-cols-2 lt-md:grid-cols-1 gap-x-4 gap-y-2.5">
              <label class="field-label">联系人（签约代表）<input :class="fi" v-model="draft.contact" /></label>
              <label class="field-label">电话<input :class="fi" v-model="draft.phone" /></label>
              <label class="field-label col-span-2">备注<input :class="fi" v-model="draft.note" /></label>
            </div>
          </section>

          <!-- 附件档案 -->
          <section class="panel p-3">
            <div class="flex items-center gap-2 mb-2.5">
              <h3 class="m-0 text-sm font-700 text-brand">附件档案</h3>
              <span class="text-ink-soft text-xs">营业执照 / 法人身份证 / 银行开户许可证 / 签约代表身份证 / 品牌授权（图片 / PDF）</span>
              <label class="ml-auto btn-primary px-2.5 py-1.25 text-xs cursor-pointer">
                ＋ 上传附件
                <input type="file" multiple accept="image/*,.pdf" hidden @change="onUpload" />
              </label>
            </div>
            <div v-if="!draft.attachments.length" class="text-ink-soft text-xs text-center border border-dashed border-line-strong rounded-md py-4">
              还没有附件。点「上传附件」，会按文件名自动归类（可手动改类别）。
            </div>
            <div v-else class="flex flex-col gap-1.5">
              <div v-for="att in draft.attachments" :key="att.id" class="flex items-center gap-2 border border-line rounded-md px-2.5 py-1.5 bg-white">
                <span class="text-base shrink-0">{{ att._isImg ? "🖼" : "📄" }}</span>
                <select v-model="att.category" class="field-input w-36 py-1 text-xs shrink-0">
                  <option v-for="c in ATTACHMENT_CATEGORIES" :key="c" :value="c">{{ c }}</option>
                </select>
                <span class="min-w-0 flex-1 truncate text-xs text-ink" :title="att.fileName">{{ att.fileName }}</span>
                <button class="btn px-2 py-0.75 text-xs shrink-0" @click="viewAttachment(att)">查看</button>
                <button class="btn-danger px-2 py-0.75 text-xs shrink-0" @click="removeAttachment(att)">删除</button>
              </div>
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

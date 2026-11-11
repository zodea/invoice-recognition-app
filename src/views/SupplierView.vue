<script setup>
import { computed, reactive, ref } from "vue";
import { invoiceStore } from "../invoiceStore";
import {
  supplierStore,
  saveSuppliers,
  emptySupplier,
  collectFromInvoices,
  exportSuppliersWorkbookBytes,
  importSuppliersWorkbookBytes,
  companySearchUrl,
  normalizeCompanyName,
} from "../lib/supplier-db";
import { openExternal } from "../lib/open-external";
import MiddleEllipsis from "../components/MiddleEllipsis.vue";
import { downloadBytes } from "../lib/file-utils.js";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";
import SupplierDetail from "../components/SupplierDetail.vue";

import { directory } from '../lib/expense-directory.js';
import { withSupplierTemplateOptions } from '../lib/supplier-template.js';
import SupplierForm from '../components/SupplierForm.vue';
import ConfirmAction from '../components/ConfirmAction.vue';
import { useConfirmation } from '../composables/useConfirmation.js';
import { DialogContent,DialogOverlay,DialogPortal,DialogRoot,DialogTitle,DialogDescription } from 'reka-ui';
import { SUPPLIER_TYPES } from '../lib/supplier-schema.js';
const {confirmation,requestConfirmation,answerConfirmation}=useConfirmation();
const db=supplierStore;
const typeOpen=ref(false),selectedType=ref(SUPPLIER_TYPES[0]),typeFilter=ref(''),importResult=ref(null);
const query = ref("");
const importInput = ref(null);

// 编辑状态：editingId = 行 id；新增时先 push 草稿再编辑
const editingId = ref("");
const draft = reactive(emptySupplier());

function persist() {
  saveSuppliers(db.list);
}

const filtered = computed(() => {
  const q = normalizeCompanyName(query.value);
  return db.list.filter((s) => {
    if(typeFilter.value && (s.type||SUPPLIER_TYPES[0])!==typeFilter.value)return false;
    if(!q)return true;
    const hay = [s.name, ...(s.aliases || []), s.taxNo, s.contact, s.phone, s.note].map(normalizeCompanyName).join("|");
    return hay.includes(q);
  });
});

function startAdd(){typeOpen.value=true;}
function confirmType(){for(const key of Object.keys(draft))delete draft[key];Object.assign(draft,emptySupplier(),{type:selectedType.value});editingId.value='__new__';typeOpen.value=false;}
function startEdit(s){for(const key of Object.keys(draft))delete draft[key];Object.assign(draft,emptySupplier(),JSON.parse(JSON.stringify(s)));editingId.value=s.id;}
function saved(again){editingId.value='';if(again)startAdd();}
async function remove(s){if(!await requestConfirmation('删除分供方','删除「'+s.name+'」的档案？历史票据仍保留原名称。'))return;try{saveSuppliers(db.list.filter(x=>x.id!==s.id));toastInfo('已删除：'+s.name);}catch(e){toastError(e.message);}}
async function downloadTemplate(){try{const response=await fetch(new URL('../assets/supplier-import.xlsx',import.meta.url));if(!response.ok)throw new Error('模板读取失败');const bytes=withSupplierTemplateOptions(new Uint8Array(await response.arrayBuffer()),{projects:directory.projects,suppliers:db.list});const name='分供方批量导入模板（下拉选项）.xlsx';const r=await saveBytesToChosenDir(bytes,name);if(r.fallbackDownload)downloadBytes(bytes,name,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');else if(!r.canceled)toast('模板已保存');}catch(e){toastError(e.message);}}

async function jumpSearch(s) {
  try {
    await openExternal(companySearchUrl(s.name));
  } catch (e) {
    toastError("打开爱企查失败：" + ((e && e.message) || e));
  }
}

// 公司详情（合作工地/材料单价/采购支付记录）
const detailOpen = ref(false);
const detailSupplier = ref(null);
function openDetail(s) {
  detailSupplier.value = s;
  detailOpen.value = true;
}

function collectNow() {
  const done = invoiceStore.invoices.filter((i) => i.status === "done");
  if (!done.length) {
    toastWarn("发票页还没有已识别的发票，先去「发票批量打印」识别。");
    return;
  }
  const next=JSON.parse(JSON.stringify(db.list));
  const r = collectFromInvoices(next, done);
  saveSuppliers(next);
  if (r.added || r.updated) toast(`从发票收集完成：新增 ${r.added} 家，补充 ${r.updated} 家。`);
  else toastInfo("没有新的销售方可收集。");
}

async function exportExcel() {
  if (!db.list.length) {
    toastWarn("分供方列表为空。");
    return;
  }
  const bytes = exportSuppliersWorkbookBytes(db.list);
  const name = "分供方资料.xlsx";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) toastInfo("已取消导出。");
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo("已下载分供方资料 Excel。"); }
    else toast(`已保存：${r.saved}`);
  } catch (e) {
    downloadBytes(bytes, name, mime);
    toastWarn("保存目录失败，已改为下载。");
  }
}

async function onImportPick(e) {
  const file = Array.from(e.target.files || []).find((f) => /\.(xlsx|xls)$/i.test(f.name));
  e.target.value = "";
  if (!file) {
    toastWarn("请选择 .xlsx / .xls 文件。");
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const next=JSON.parse(JSON.stringify(db.list));
    const r = importSuppliersWorkbookBytes(next, bytes);
    saveSuppliers(next);
    importResult.value=r;
    toast(`导入完成：读取 ${r.imported} 行，新增 ${r.added} 家，补充 ${r.updated} 家。`);
  } catch (err) {
    toastError("导入失败：" + ((err && err.message) || err));
  }
}

</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <h2 class="m-0 text-[15px] font-700">分供方资料库</h2>
      <span class="text-ink-soft text-xs">共 {{ db.list.length }} 家；供送货单文件夹简称映射、单价对比与对账使用</span>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <select v-model="typeFilter" class="field-input supplier-type-filter" aria-label="分供方类型筛选"><option value="">全部类型</option><option v-for="type in SUPPLIER_TYPES" :key="type">{{ type }}</option></select>
        <input v-model="query" class="field-input w-56 py-1.5" placeholder="搜索 名称/别名/税号/联系人" />
        <button class="btn-primary px-2.75 py-1.5" @click="startAdd">＋ 新增分供方</button>
        <button class="btn px-2.75 py-1.5" @click="collectNow">从已识别发票收集</button>
        <button class="btn px-2.75 py-1.5" @click="downloadTemplate">下载导入模板</button>
        <button class="btn px-2.75 py-1.5" @click="importInput.click()">导入 Excel</button>
        <button class="btn px-2.75 py-1.5" :disabled="!db.list.length" @click="exportExcel">导出 Excel</button>
        <input ref="importInput" type="file" accept=".xlsx,.xls" hidden @change="onImportPick" />
      </div>
    </div>

    <SupplierForm v-if="editingId" :key="draft.id" :record="draft" :is-new="editingId==='__new__'" @close="editingId=''" @saved="saved" />
    <DialogRoot :open="typeOpen" @update:open="typeOpen=$event"><DialogPortal><DialogOverlay class="supplier-choice-overlay" /><DialogContent class="supplier-choice"><DialogTitle>新建分供方</DialogTitle><DialogDescription>选择分供方类型，填写对应资料。</DialogDescription><label v-for="type in SUPPLIER_TYPES" :key="type"><input v-model="selectedType" type="radio" :value="type" name="supplier-type" />{{ type }}</label><footer><button class="btn" @click="typeOpen=false">取消</button><button class="btn-primary" @click="confirmType">确定</button></footer></DialogContent></DialogPortal></DialogRoot>
    <DialogRoot :open="!!importResult" @update:open="value=>{if(!value)importResult=null}"><DialogPortal><DialogOverlay class="supplier-choice-overlay" /><DialogContent class="supplier-import-result"><DialogTitle>批量导入结果</DialogTitle><DialogDescription v-if="importResult">成功读取 {{ importResult.imported }} 行，新增 {{ importResult.added }} 家，补充 {{ importResult.updated }} 家。资料和附件可稍后在编辑界面补全。</DialogDescription><ul v-if="importResult?.errors.length"><li v-for="(error,index) in importResult.errors" :key="index">{{ error.sheet }} 第 {{ error.row }} 行 · {{ error.name }}：{{ error.message }}</li></ul><p v-else>没有发现格式错误。</p><button class="btn-primary" @click="importResult=null">知道了</button></DialogContent></DialogPortal></DialogRoot>
    <ConfirmAction :request="confirmation" @answer="answerConfirmation" />

    <!-- 列表：vxe-table，固定表头 + 固定首列(公司全称)/尾列(操作)，超宽超高滚动 -->
    <div class="panel p-2">
      <vxe-table
        :data="filtered"
        height="560"
        size="small"
        border
        show-overflow
        :row-config="{ isHover: true }"
        :column-config="{ resizable: true }"
        :empty-text="db.list.length ? '没有匹配的分供方。' : '还没有分供方。可手动新增、从已识别发票收集，或导入现有 Excel。'"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="公司全称" min-width="230" fixed="left">
          <template #default="{ row }">
            <button class="border-none bg-transparent p-0 text-brand font-600 cursor-pointer hover:underline text-left" style="max-width: 100%" @click="openDetail(row)">
              <MiddleEllipsis :text="row.name" />
            </button>
          </template>
        </vxe-column>
        <vxe-column title="简称/别名" min-width="130">
          <template #default="{ row }">{{ [row.shortName,...(row.aliases || [])].filter(Boolean).join("、") }}</template>
        </vxe-column>
        <vxe-column title="类型 / 资料" width="160"><template #default="{ row }">{{ row.type || SUPPLIER_TYPES[0] }}<br /><small class="text-ink-soft">{{ row.status || '待补全' }} · {{ (row.attachments || []).length }} 个附件</small></template></vxe-column>
        <vxe-column field="taxNo" title="税号" width="185" />
        <vxe-column field="bank" title="开户行" min-width="150" />
        <vxe-column field="bankAccount" title="银行账号" width="175" />
        <vxe-column title="联系人/电话" width="150">
          <template #default="{ row }">{{ [row.contact, row.phone].filter(Boolean).join(" / ") }}</template>
        </vxe-column>
        <vxe-column field="note" title="备注" min-width="120" />
        <vxe-column title="操作" width="190" fixed="right">
          <template #default="{ row }">
            <div class="flex gap-1.5 flex-wrap">
              <button class="btn px-2 py-1 text-xs" @click="openDetail(row)">详情</button>
              <button class="btn px-2 py-1 text-xs text-brand border-brand" title="在爱企查搜索该公司（免登录）" @click="jumpSearch(row)">爱企查</button>
              <button class="btn px-2 py-1 text-xs" @click="startEdit(row)">编辑</button>
              <button class="btn-danger px-2 py-1 text-xs" @click="remove(row)">删除</button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <SupplierDetail v-model:open="detailOpen" :supplier="detailSupplier" @changed="persist" />
  </div>
</template>

<style scoped>
.supplier-type-filter{width:150px!important;min-width:150px}
.supplier-choice-overlay{position:fixed;inset:0;background:#15263c66;z-index:60}.supplier-choice,.supplier-import-result{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:61;width:min(560px,90vw);max-height:80vh;overflow:auto;background:white;border-radius:10px;padding:26px;outline:none}.supplier-choice h2,.supplier-import-result h2{font-size:21px;margin:0 0 15px}.supplier-choice p,.supplier-import-result p{color:#7c8998;font-size:13px}.supplier-choice label{display:flex;align-items:center;gap:12px;padding:12px 4px}.supplier-choice input{width:18px;height:18px;accent-color:#1769cb}.supplier-choice footer{display:flex;justify-content:flex-end;gap:12px;border-top:1px solid #e5eaf0;margin-top:20px;padding-top:16px}.supplier-import-result li{margin:10px 0;color:#a34e11;line-height:1.7}
</style>

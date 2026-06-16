<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { invoiceStore } from "../invoiceStore";
import { useSupplierStore } from "../stores/supplier";
import {
  collectFromInvoices,
  exportSuppliersWorkbookBytes,
  importSuppliersWorkbookBytes,
  normalizeCompanyName,
} from "../lib/supplier-db";
import { downloadBytes } from "../lib/invoice-layout";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";
import SupplierFormDialog from "../components/SupplierFormDialog.vue";

const router = useRouter();
const supplierStore = useSupplierStore();
const query = ref("");
const importInput = ref(null);

// 新增/编辑走弹窗（SupplierFormDialog）；详情改路由页 /supplier/:id（issue #21，去模态嵌套）。
const formOpen = ref(false);
const formSupplier = ref(null); // null = 新增

const filtered = computed(() => {
  const q = normalizeCompanyName(query.value);
  if (!q) return supplierStore.list;
  return supplierStore.list.filter((s) => {
    const hay = [s.name, ...(s.aliases || []), s.taxNo, s.contact, s.phone, s.note].map(normalizeCompanyName).join("|");
    return hay.includes(q);
  });
});

function startAdd() {
  formSupplier.value = null;
  formOpen.value = true;
}
function startEdit(s) {
  formSupplier.value = s;
  formOpen.value = true;
}
// 弹窗保存：dup 校验 + 新增/替换 + 持久化；keepOpen=保存并继续新增。
function onFormSubmit({ record, isNew, keepOpen }) {
  const name = (record.name || "").trim();
  const dup = supplierStore.findDuplicate(name, record.id);
  if (dup) {
    toastWarn(`已存在同名分供方：${dup.name}`);
    return;
  }
  if (isNew) {
    supplierStore.add(record);
    toast(`已新增分供方：${name}`);
  } else {
    supplierStore.update(record);
    toast(`已保存：${name}`);
  }
  if (!keepOpen) formOpen.value = false;
}
function remove(s) {
  if (!window.confirm(`删除分供方「${s.name}」？不影响已导出的文件。`)) return;
  supplierStore.remove(s.id);
  toastInfo(`已删除：${s.name}`);
}
function openDetail(s) {
  router.push(`/supplier/${s.id}`);
}

function collectNow() {
  const done = invoiceStore.invoices.filter((i) => i.status === "done");
  if (!done.length) {
    toastWarn("发票页还没有已识别的发票，先去「发票批量打印」识别。");
    return;
  }
  const r = collectFromInvoices(supplierStore.list, done);
  supplierStore.persist();
  if (r.added || r.updated) toast(`从发票收集完成：新增 ${r.added} 家，补充 ${r.updated} 家。`);
  else toastInfo("没有新的销售方可收集。");
}

async function exportExcel() {
  if (!supplierStore.list.length) {
    toastWarn("分供方列表为空。");
    return;
  }
  const bytes = exportSuppliersWorkbookBytes(supplierStore.list);
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
    const r = importSuppliersWorkbookBytes(supplierStore.list, bytes);
    supplierStore.persist();
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
      <span class="text-ink-soft text-xs">共 {{ supplierStore.list.length }} 家；供送货单文件夹简称映射、单价对比与对账使用</span>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <input v-model="query" class="field-input w-56 py-1.5" placeholder="搜索 名称/别名/税号/联系人" />
        <button class="btn-primary px-2.75 py-1.5" @click="startAdd">＋ 新增分供方</button>
        <button class="btn px-2.75 py-1.5" @click="collectNow">从已识别发票收集</button>
        <button class="btn px-2.75 py-1.5" @click="importInput.click()">导入 Excel</button>
        <button class="btn px-2.75 py-1.5" :disabled="!supplierStore.list.length" @click="exportExcel">导出 Excel</button>
        <input ref="importInput" type="file" accept=".xlsx,.xls" hidden @change="onImportPick" />
      </div>
    </div>

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
        :empty-text="supplierStore.list.length ? '没有匹配的分供方。' : '还没有分供方。可手动新增、从已识别发票收集，或导入现有 Excel。'"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="公司全称" min-width="230" fixed="left">
          <template #default="{ row }">
            <button class="border-none bg-transparent p-0 text-brand font-600 cursor-pointer hover:underline text-left" :title="'查看合作工地/材料单价/采购支付记录'" @click="openDetail(row)">
              {{ row.name }}
            </button>
          </template>
        </vxe-column>
        <vxe-column title="简称/别名" min-width="130">
          <template #default="{ row }">{{ (row.aliases || []).join("、") }}</template>
        </vxe-column>
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
              <button class="btn px-2 py-1 text-xs" @click="startEdit(row)">编辑</button>
              <button class="btn-danger px-2 py-1 text-xs" @click="remove(row)">删除</button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <SupplierFormDialog v-model:open="formOpen" :supplier="formSupplier" @submit="onFormSubmit" />
  </div>
</template>

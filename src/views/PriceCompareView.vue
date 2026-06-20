<script setup>
// 单价对比（issue #7）：行=材料（归一化+手动并组），列=供应商，单元格=最近价(+区间)，高亮最低价。
// 数据源：store 当前已识别明细 + 导入的历史「送货单整理汇总.xlsx」。
import { computed, onMounted, ref } from "vue";
import { store } from "../store";
import { useRecognizedStore } from "../stores/recognized";
import {
  buildPriceCompare,
  mergeGroups,
  splitGroup,
  loadManualGroups,
  saveManualGroups,
  importHistoryWorkbookItems,
  buildImportTemplateBytes,
  exportPriceCompareWorkbookBytes,
  loadExcludeRules,
  saveExcludeRules,
  setExcludeRule,
  obsFromDeliveryItems,
  dedupObs,
} from "../lib/price-compare";
import { downloadBytes } from "../lib/invoice-layout";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

const importedObs = ref([]); // 历史 Excel 导入的观测点
const recognized = useRecognizedStore();
onMounted(() => recognized.ensureLoaded()); // 读回已入库的识别明细库（issue #14）
const manualGroups = ref(loadManualGroups());
const excludeRules = ref(loadExcludeRules()); // 排除集（运费类等不参与对比，issue #20）
const siteFilter = ref(""); // "" = 全部工地汇总
const tableRef = ref(null);
const importInput = ref(null);

const siteOptions = computed(() => [{ value: "", label: "全部工地（汇总）" }, ...store.partitions.map((p) => ({ value: p.name, label: p.name }))]);
// 只读「已保存入库」的识别明细库 + 历史导入；未点「保存到分供方&单价对比」的本次会话数据不在此显示（issue：显式保存语义）。
const obs = computed(() => dedupObs([...obsFromDeliveryItems(recognized.allDeliveryItems()), ...importedObs.value]));
const compare = computed(() => buildPriceCompare(obs.value, { manualGroups: manualGroups.value, site: siteFilter.value, excludeRules: excludeRules.value }));

function fmtCell(v) {
  if (!v) return "";
  return v.min === v.max ? String(v.recent) : `${v.recent}（${v.min}~${v.max}）`;
}

function mergeSelected() {
  const recs = (tableRef.value && tableRef.value.getCheckboxRecords()) || [];
  if (recs.length < 2) {
    toastWarn("勾选至少 2 行同类材料再并组。");
    return;
  }
  manualGroups.value = mergeGroups(manualGroups.value, recs[0].key, recs.map((r) => r.key));
  saveManualGroups(manualGroups.value);
  toast(`已并组 ${recs.length} 项 → 「${recs[0].name}」。`);
}
function splitRow(row) {
  manualGroups.value = splitGroup(manualGroups.value, row.key);
  saveManualGroups(manualGroups.value);
  toastInfo(`已拆分「${row.name}」。`);
}

// 排除集（issue #20）：把某材料从对比剔除 / 恢复，持久化、下次同名自动生效。
function excludeRow(row) {
  let m = excludeRules.value;
  for (const k of (row.keys && row.keys.length ? row.keys : [row.key])) m = setExcludeRule(m, k, true);
  excludeRules.value = m;
  saveExcludeRules(m);
  toastInfo(`已从对比剔除「${row.name}」。`);
}
function restoreExcluded(e) {
  excludeRules.value = setExcludeRule(excludeRules.value, e.normKey, false);
  saveExcludeRules(excludeRules.value);
  toast(`已恢复「${e.name}」参与对比。`);
}

async function onImportPick(e) {
  const file = Array.from(e.target.files || []).find((f) => /\.(xlsx|xls)$/i.test(f.name));
  e.target.value = "";
  if (!file) {
    toastWarn("请选择 .xlsx / .xls（送货单整理汇总）。");
    return;
  }
  try {
    const items = importHistoryWorkbookItems(new Uint8Array(await file.arrayBuffer()));
    if (!items.length) {
      toastWarn("没读到可对比的明细（确认是「送货单整理汇总.xlsx」）。");
      return;
    }
    importedObs.value = [...importedObs.value, ...items];
    toast(`已导入历史明细 ${items.length} 条。`);
  } catch (err) {
    toastError("导入失败：" + ((err && err.message) || err));
  }
}

async function downloadTemplate() {
  const bytes = buildImportTemplateBytes();
  const name = "单价对比导入模板.xlsx";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) toastInfo("已取消。");
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo("已下载导入模板。"); }
    else toast(`已保存：${r.saved}`);
  } catch (e) {
    downloadBytes(bytes, name, mime);
    toastInfo("已下载导入模板。");
  }
}

async function exportExcel() {
  if (!compare.value.rows.length) {
    toastWarn("没有可导出的对比数据。");
    return;
  }
  const bytes = exportPriceCompareWorkbookBytes(compare.value);
  const name = "材料单价对比.xlsx";
  const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  try {
    const r = await saveBytesToChosenDir(bytes, name);
    if (r.canceled) toastInfo("已取消导出。");
    else if (r.fallbackDownload) { downloadBytes(bytes, name, mime); toastInfo("已下载单价对比 Excel。"); }
    else toast(`已保存：${r.saved}`);
  } catch (e) {
    downloadBytes(bytes, name, mime);
    toastWarn("保存目录失败，已改为下载。");
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex flex-col gap-2">
      <div class="flex items-center gap-2.5 flex-wrap">
        <span class="text-sm font-700">材料单价对比</span>
        <span class="text-ink-soft text-xs">对比各分供方材料单价，绿色为最低价</span>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <select v-model="siteFilter" class="field-input w-40 py-1.5">
          <option v-for="o in siteOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="btn px-2.75 py-1.5" :disabled="!compare.rows.length" @click="mergeSelected">并组所选</button>
        <button class="btn px-2.75 py-1.5" title="下载空白模板，填好后导入" @click="downloadTemplate">
          <span class="i-lucide-download w-3.5 h-3.5 flex-none"></span>
          下载模板
        </button>
        <button class="btn px-2.75 py-1.5" @click="importInput.click()">
          <span class="i-lucide-upload w-3.5 h-3.5 flex-none"></span>
          导入历史
        </button>
        <button class="btn px-2.75 py-1.5" :disabled="!compare.rows.length" @click="exportExcel">
          <span class="i-lucide-download w-3.5 h-3.5 flex-none"></span>
          导出 Excel
        </button>
        <input ref="importInput" type="file" accept=".xlsx,.xls" hidden @change="onImportPick" />
      </div>
    </div>

    <details v-if="compare.excluded.length" class="panel p-2.5">
      <summary class="cursor-pointer text-ink-soft text-[13px]">已从对比剔除 {{ compare.excluded.length }} 类（运费类等不参与最低价对比；送货单明细 / 导出仍保留）</summary>
      <div class="flex flex-wrap gap-1.5 mt-2">
        <span v-for="e in compare.excluded" :key="e.normKey" class="chip border border-line bg-white px-2 py-1 inline-flex items-center gap-1.5">
          {{ e.name }}<span class="text-ink-soft text-xs">×{{ e.count }}</span>
          <button class="border-none bg-transparent text-brand cursor-pointer text-xs" title="恢复参与对比" @click="restoreExcluded(e)">恢复</button>
        </span>
      </div>
    </details>

    <div class="panel p-2">
      <vxe-table
        ref="tableRef"
        :data="compare.rows"
        height="600"
        size="small"
        border
        show-overflow
        :row-config="{ isHover: true, keyField: 'key' }"
        :column-config="{ resizable: true }"
        :empty-text="'还没有可对比的明细。先在「送货单整理」识别送货单，或点「导入历史 Excel」。'"
      >
        <vxe-column type="checkbox" width="44" fixed="left" />
        <vxe-column type="seq" title="#" width="48" fixed="left" />
        <vxe-column field="name" title="材料（归组）" min-width="220" fixed="left">
          <template #default="{ row }">
            <div class="font-600">{{ row.name }}</div>
            <div v-if="row.names.length > 1" class="text-ink-soft text-[11px]" :title="row.names.join(' / ')">含 {{ row.names.length }} 种写法</div>
          </template>
        </vxe-column>
        <vxe-column field="unit" title="单位" width="64" />
        <vxe-column v-for="s in compare.suppliers" :key="s" :field="s" :title="s" min-width="120" align="right">
          <template #default="{ row }">
            <span v-if="row.bySupplier[s]" :class="row.lowest === s ? 'text-success font-700' : ''" :title="row.lowest === s ? '最低价' : ''">
              {{ fmtCell(row.bySupplier[s]) }}<span v-if="row.lowest === s"> ✓</span>
            </span>
            <span v-else class="text-ink-soft">—</span>
          </template>
        </vxe-column>
        <vxe-column title="最低价供应商" width="130" fixed="right">
          <template #default="{ row }"><span class="text-success font-600">{{ row.lowest || "—" }}</span></template>
        </vxe-column>
        <vxe-column title="操作" width="128" fixed="right">
          <template #default="{ row }">
            <div class="flex gap-1.5">
              <button v-if="row.names.length > 1" class="btn px-2 py-1 text-xs" title="解除该组的手动并组" @click="splitRow(row)">拆分</button>
              <button class="btn px-2 py-1 text-xs" title="把该材料从单价对比剔除（如运费类）" @click="excludeRow(row)">排除</button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>
  </div>
</template>

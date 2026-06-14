<script setup>
// 单价对比（issue #7）：行=材料（归一化+手动并组），列=供应商，单元格=最近价(+区间)，高亮最低价。
// 数据源：store 当前已识别明细 + 导入的历史「送货单整理汇总.xlsx」。
import { computed, ref } from "vue";
import { store } from "../store";
import {
  aggregateItems,
  buildPriceCompare,
  mergeGroups,
  splitGroup,
  loadManualGroups,
  saveManualGroups,
  importHistoryWorkbookItems,
  exportPriceCompareWorkbookBytes,
} from "../lib/price-compare";
import { downloadBytes } from "../lib/invoice-layout";
import { saveBytesToChosenDir } from "../lib/invoice-export-package";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

const importedObs = ref([]); // 历史 Excel 导入的观测点
const manualGroups = ref(loadManualGroups());
const siteFilter = ref(""); // "" = 全部工地汇总
const tableRef = ref(null);
const importInput = ref(null);

const siteOptions = computed(() => [{ value: "", label: "全部工地（汇总）" }, ...store.partitions.map((p) => ({ value: p.name, label: p.name }))]);
const obs = computed(() => [...aggregateItems(store.files, store.partitions), ...importedObs.value]);
const compare = computed(() => buildPriceCompare(obs.value, { manualGroups: manualGroups.value, site: siteFilter.value }));

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
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <h2 class="m-0 text-[15px] font-700">材料单价对比</h2>
      <span class="text-ink-soft text-xs">跨供应商对比同一材料单价；归一化自动归组，拿不准的勾选后手动并组</span>
      <div class="ml-auto flex items-center gap-2 flex-wrap">
        <select v-model="siteFilter" class="field-input w-40 py-1.5">
          <option v-for="o in siteOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="btn px-2.75 py-1.5" :disabled="!compare.rows.length" @click="mergeSelected">并组所选</button>
        <button class="btn px-2.75 py-1.5" @click="importInput.click()">导入历史 Excel</button>
        <button class="btn px-2.75 py-1.5" :disabled="!compare.rows.length" @click="exportExcel">导出 Excel</button>
        <input ref="importInput" type="file" accept=".xlsx,.xls" hidden @change="onImportPick" />
      </div>
    </div>

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
        <vxe-column title="操作" width="84" fixed="right">
          <template #default="{ row }">
            <button v-if="row.names.length > 1" class="btn px-2 py-1 text-xs" title="解除该组的手动并组" @click="splitRow(row)">拆分</button>
          </template>
        </vxe-column>
      </vxe-table>
    </div>
  </div>
</template>

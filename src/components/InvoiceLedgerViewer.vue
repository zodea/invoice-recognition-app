<script setup>
import { computed, ref, watch } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { invoiceStore } from "../invoiceStore";

const props = defineProps({ open: Boolean });
const emit = defineEmits(["update:open"]);

const yearFilter = ref("全部");
const companyQuery = ref("");
const sortKey = ref("date"); // date/seller/total/amount/number
const sortDir = ref("desc"); // asc/desc
const page = ref(1);
const pageSize = ref(20);

const allEntries = computed(() => Object.values(invoiceStore.ledger || {}));
const years = computed(() => {
  const ys = new Set();
  for (const e of allEntries.value) {
    const y = (e.date || "").slice(0, 4);
    if (/^\d{4}$/.test(y)) ys.add(y);
  }
  return ["全部", ...[...ys].sort().reverse()];
});

const filtered = computed(() => {
  const q = companyQuery.value.trim();
  let list = allEntries.value.filter((e) => {
    if (yearFilter.value !== "全部" && (e.date || "").slice(0, 4) !== yearFilter.value) return false;
    if (q && !(e.seller || "").includes(q) && !(e.number || "").includes(q)) return false;
    return true;
  });
  const dir = sortDir.value === "asc" ? 1 : -1;
  const k = sortKey.value;
  return list.slice().sort((a, b) => {
    if (k === "total" || k === "amount") return ((Number(a[k]) || 0) - (Number(b[k]) || 0)) * dir;
    return String(a[k] || "").localeCompare(String(b[k] || "")) * dir;
  });
});

const totalSum = computed(() => filtered.value.reduce((s, e) => s + (Number(e.total) || 0), 0));
const amountSum = computed(() => filtered.value.reduce((s, e) => s + (Number(e.amount) || 0), 0));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value;
  return filtered.value.slice(start, start + pageSize.value);
});

function setSort(k) {
  if (sortKey.value === k) sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  else {
    sortKey.value = k;
    sortDir.value = k === "total" || k === "amount" || k === "date" ? "desc" : "asc";
  }
}
function sortIcon(k) {
  if (sortKey.value !== k) return "↕";
  return sortDir.value === "asc" ? "↑" : "↓";
}
watch([yearFilter, companyQuery, pageSize, sortKey, sortDir], () => { page.value = 1; });
watch(() => props.open, (v) => { if (v) page.value = 1; });

const th = "px-2.5 py-2 text-left font-700 text-ink-soft whitespace-nowrap cursor-pointer select-none hover:text-brand";
const td = "px-2.5 py-1.5 whitespace-nowrap border-t border-line";
const money = (n) => (Number(n) || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[min(1100px,94vw)] max-h-[90vh] flex flex-col bg-panel rounded-card shadow-pop border border-line overflow-hidden outline-none"
      >
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-line">
          <DialogTitle class="m-0 text-base font-700">进项发票台账 · 共 {{ allEntries.length }} 条</DialogTitle>
          <DialogClose class="btn px-2.5 py-1.5">✕ 关闭</DialogClose>
        </div>

        <!-- 筛选 -->
        <div class="flex items-center gap-3 flex-wrap px-4 py-2.5 border-b border-line bg-[#f8fafc]">
          <label class="flex items-center gap-1.5 text-xs text-ink-soft">年份
            <select v-model="yearFilter" class="field-input w-24 py-1">
              <option v-for="y in years" :key="y" :value="y">{{ y }}</option>
            </select>
          </label>
          <label class="flex items-center gap-1.5 text-xs text-ink-soft">公司/号码
            <input v-model="companyQuery" placeholder="搜索销售方或发票号码" class="field-input w-56 py-1" />
          </label>
          <label class="flex items-center gap-1.5 text-xs text-ink-soft ml-auto">每页
            <select v-model.number="pageSize" class="field-input w-20 py-1">
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
              <option :value="500">500</option>
            </select>
          </label>
        </div>

        <!-- 表格 -->
        <div class="flex-1 overflow-auto min-h-0">
          <table class="w-full text-xs border-collapse">
            <thead class="sticky top-0 bg-white z-1 shadow-[0_1px_0_var(--line)]">
              <tr>
                <th :class="th" @click="setSort('number')">发票号码 {{ sortIcon('number') }}</th>
                <th :class="th" @click="setSort('date')">开票日期 {{ sortIcon('date') }}</th>
                <th :class="th" @click="setSort('seller')">销售方(公司) {{ sortIcon('seller') }}</th>
                <th :class="th + ' text-right'" @click="setSort('amount')">金额 {{ sortIcon('amount') }}</th>
                <th :class="th + ' text-right'" @click="setSort('total')">价税合计 {{ sortIcon('total') }}</th>
                <th :class="th">状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in paged" :key="e.number || i" class="hover:bg-brand-soft/40">
                <td :class="td + ' font-mono'">{{ e.number || "—" }}</td>
                <td :class="td">{{ e.date || "—" }}</td>
                <td :class="td + ' whitespace-normal max-w-80'">{{ e.seller || "—" }}</td>
                <td :class="td + ' text-right tabular-nums'">{{ money(e.amount) }}</td>
                <td :class="td + ' text-right tabular-nums font-700'">{{ money(e.total) }}</td>
                <td :class="td">
                  <span v-if="e.printed" class="chip bg-[#f0fdf4] text-[#166534] border border-[#bbf7d0] px-1.5 py-0.5">已打印</span>
                  <span v-else-if="e.verified" class="chip bg-brand-soft text-brand px-1.5 py-0.5">已认证</span>
                  <span v-else class="text-ink-soft">—</span>
                </td>
              </tr>
              <tr v-if="!filtered.length">
                <td :class="td + ' text-center text-ink-soft py-8'" colspan="6">
                  {{ allEntries.length ? "没有符合筛选条件的记录。" : "还没有导入进项台账数据。" }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 汇总 + 分页 -->
        <div class="flex items-center gap-3 flex-wrap px-4 py-2.5 border-t border-line bg-[#f8fafc] text-xs">
          <div class="text-ink-soft">
            筛选后 <b class="text-ink">{{ filtered.length }}</b> 笔 · 金额合计 <b class="text-ink tabular-nums">{{ money(amountSum) }}</b> · 价税合计
            <b class="text-brand tabular-nums">{{ money(totalSum) }}</b>
          </div>
          <div class="flex items-center gap-1.5 ml-auto">
            <button class="btn px-2.5 py-1" :disabled="page <= 1" @click="page--">上一页</button>
            <span class="text-ink-soft tabular-nums">第 {{ page }} / {{ pageCount }} 页</span>
            <button class="btn px-2.5 py-1" :disabled="page >= pageCount" @click="page++">下一页</button>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

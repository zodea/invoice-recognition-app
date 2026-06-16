<script setup>
// 工地详情（路由页 /site/:id，issue #21）：按公司汇总该工地的送货单（份数/金额），
// 公司可点进分供方详情。识别明细库落地后（#14）这里会读持久数据，目前读当前会话 store.files。
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { store } from "../store";
import { loadSuppliers, matchSupplier } from "../lib/supplier-db";

const route = useRoute();
const router = useRouter();
const partition = computed(() => store.partitions.find((p) => p.id === route.params.id) || null);
const files = computed(() => store.files.filter((f) => f.partitionId === route.params.id));

const byCompany = computed(() => {
  const map = new Map();
  const suppliers = loadSuppliers();
  for (const f of files.value) {
    const name = (f.company || "").trim() || "未命名公司";
    if (!map.has(name)) {
      const hit = matchSupplier(suppliers, name);
      map.set(name, { company: name, supplierId: hit ? hit.supplier.id : "", count: 0, amount: 0 });
    }
    const g = map.get(name);
    g.count++;
    for (const d of f.docs || []) for (const it of d.items || []) g.amount += Number(it.total) || 0;
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
});
const totalAmount = computed(() => byCompany.value.reduce((s, g) => s + g.amount, 0));
const money = (v) => (Number(v) || 0).toFixed(2);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="panel p-3 flex items-center gap-2.5 flex-wrap">
      <button class="btn px-2.5 py-1.5" @click="router.push('/delivery')">← 返回送货单整理</button>
      <h2 class="m-0 text-base font-700">工地：{{ partition?.name || "（未找到）" }}</h2>
      <span class="text-ink-soft text-xs" v-if="partition">{{ files.length }} 个文件 · {{ byCompany.length }} 个公司 · 合计 ¥{{ money(totalAmount) }}</span>
    </div>
    <div v-if="!partition" class="panel p-6 text-center text-ink-soft">未找到该工地。<button class="btn px-2.5 py-1 ml-2" @click="router.push('/delivery')">返回</button></div>
    <div v-else class="panel p-2.5">
      <h3 class="m-0 mb-2 text-sm font-700">按公司汇总</h3>
      <vxe-table v-if="byCompany.length" :data="byCompany" height="440" size="small" border show-overflow :row-config="{ isHover: true }">
        <vxe-column field="company" title="公司" min-width="240">
          <template #default="{ row }">
            <button v-if="row.supplierId" class="border-none bg-transparent p-0 text-brand font-600 cursor-pointer hover:underline" @click="router.push(`/supplier/${row.supplierId}`)">{{ row.company }}</button>
            <span v-else>{{ row.company }}</span>
          </template>
        </vxe-column>
        <vxe-column field="count" title="送货单(份)" width="120" align="right" />
        <vxe-column field="amount" title="金额合计" width="150" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </vxe-column>
      </vxe-table>
      <div v-else class="text-ink-soft text-xs">该工地暂无已识别的送货单。</div>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive } from "vue";
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from "reka-ui";
import { store } from "../store";
import { aggregateSupplierDelivery, emptyPurchase, emptyPayment, companySearchUrl } from "../lib/supplier-db";
import { openExternal } from "../lib/open-external";
import { toast, toastError, toastInfo, toastWarn } from "../lib/toast";

const props = defineProps({ open: Boolean, supplier: Object });
const emit = defineEmits(["update:open", "changed"]);

// 合作数据：从送货单整理（分区=工地）实时聚合；送货单识别完成越多，这里越全
const coop = computed(() => {
  if (!props.supplier) return { sites: [], items: [], totalAmount: 0 };
  return aggregateSupplierDelivery(props.supplier, store.files, store.partitions);
});

const purchases = computed(() => props.supplier?.purchases || []);
const payments = computed(() => props.supplier?.payments || []);
const purchaseSum = computed(() => purchases.value.reduce((s, r) => s + (Number(r.total) || 0), 0));
const paySum = computed(() => payments.value.reduce((s, r) => s + (Number(r.amount) || 0), 0));
const balance = computed(() => Math.round((purchaseSum.value + coop.value.totalAmount - paySum.value) * 100) / 100);

const draftP = reactive(emptyPurchase());
const draftM = reactive(emptyPayment());

function recalcDraftTotal() {
  const q = parseFloat(draftP.quantity);
  const p = parseFloat(draftP.unitPrice);
  if (Number.isFinite(q) && Number.isFinite(p)) draftP.total = Math.round(q * p * 100) / 100;
}
function addPurchase() {
  if (!draftP.date && !draftP.item) {
    toastWarn("采购记录至少填 日期 或 材料。");
    return;
  }
  if (!props.supplier.purchases) props.supplier.purchases = [];
  props.supplier.purchases.push({ ...draftP });
  Object.assign(draftP, emptyPurchase());
  emit("changed");
  toast("已添加采购记录。");
}
function delPurchase(id) {
  const arr = props.supplier.purchases || [];
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  emit("changed");
}
function addPayment() {
  if (!draftM.date || !(Number(draftM.amount) > 0)) {
    toastWarn("支付记录需要 日期 和 金额。");
    return;
  }
  if (!props.supplier.payments) props.supplier.payments = [];
  props.supplier.payments.push({ ...draftM });
  Object.assign(draftM, emptyPayment());
  emit("changed");
  toast("已添加支付记录。");
}
function delPayment(id) {
  const arr = props.supplier.payments || [];
  const i = arr.findIndex((x) => x.id === id);
  if (i >= 0) arr.splice(i, 1);
  emit("changed");
}

async function jumpSearch() {
  try {
    await openExternal(companySearchUrl(props.supplier.name));
  } catch (e) {
    toastError("打开爱企查失败：" + ((e && e.message) || e));
  }
}

const money = (v) => (Number(v) || 0).toFixed(2);
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="fixed z-51 top-[4vh] left-1/2 -translate-x-1/2 w-[min(1100px,94vw)] max-h-[92vh] overflow-auto bg-bg rounded-card shadow-pop p-4 outline-none"
      >
        <div class="flex items-center gap-2.5 flex-wrap mb-3">
          <DialogTitle class="m-0 text-base font-700">{{ supplier?.name || "分供方详情" }}</DialogTitle>
          <button class="btn px-2 py-1 text-xs text-brand border-brand" @click="jumpSearch">爱企查</button>
          <span class="text-ink-soft text-xs">税号：{{ supplier?.taxNo || "—" }}　开户行：{{ supplier?.bank || "—" }}　账号：{{ supplier?.bankAccount || "—" }}</span>
          <DialogClose class="ml-auto btn px-2.5 py-1">关闭 ✕</DialogClose>
        </div>

        <!-- 对账汇总 -->
        <div class="panel p-2.5 mb-3 flex gap-5 flex-wrap text-ink-soft text-[13px]">
          <span>送货单合计 <b class="text-ink text-[15px]">{{ money(coop.totalAmount) }}</b></span>
          <span>手记采购合计 <b class="text-ink text-[15px]">{{ money(purchaseSum) }}</b></span>
          <span>已支付合计 <b class="text-ok text-[15px]">{{ money(paySum) }}</b></span>
          <span>差额(应付) <b :class="balance > 0 ? 'text-danger' : 'text-ok'" class="text-[15px]">{{ money(balance) }}</b></span>
        </div>

        <!-- 合作工地 -->
        <div class="panel p-2.5 mb-3">
          <h3 class="m-0 mb-2 text-sm font-700">合作工地（来自送货单整理，自动汇总）</h3>
          <div v-if="coop.sites.length" class="flex gap-2 flex-wrap">
            <span v-for="s in coop.sites" :key="s.name" class="chip border border-line bg-white px-2.5 py-1">
              {{ s.name }} · {{ s.fileCount }} 份 · ¥{{ money(s.amount) }}
            </span>
          </div>
          <div v-else class="text-ink-soft text-xs">暂无。到「送货单整理」上传并识别该公司的送货单后，这里自动汇总工地与材料。</div>
        </div>

        <!-- 材料明细 -->
        <div class="panel p-2.5 mb-3">
          <h3 class="m-0 mb-2 text-sm font-700">材料与单价（{{ coop.items.length }} 条）</h3>
          <vxe-table v-if="coop.items.length" :data="coop.items" height="260" size="mini" border show-overflow :row-config="{ isHover: true }">
            <vxe-column field="date" title="日期" width="100" fixed="left" />
            <vxe-column field="site" title="工地" width="120" />
            <vxe-column field="name" title="材料名称" min-width="200" />
            <vxe-column field="unit" title="单位" width="60" />
            <vxe-column field="quantity" title="数量" width="80" align="right" />
            <vxe-column field="unitPrice" title="单价" width="90" align="right" />
            <vxe-column field="total" title="总价" width="100" align="right" />
          </vxe-table>
          <div v-else class="text-ink-soft text-xs">暂无材料明细。</div>
        </div>

        <!-- 采购记录 -->
        <div class="panel p-2.5 mb-3">
          <h3 class="m-0 mb-2 text-sm font-700">采购记录（手动补记，送货单之外的）</h3>
          <div class="grid grid-cols-8 lt-lg:grid-cols-4 gap-1.5 mb-2">
            <input class="field-input" v-model="draftP.date" placeholder="日期 2026-06-12" />
            <input class="field-input" v-model="draftP.site" placeholder="工地" />
            <input class="field-input col-span-2" v-model="draftP.item" placeholder="材料/事项" />
            <input class="field-input" v-model="draftP.quantity" @input="recalcDraftTotal" placeholder="数量" inputmode="decimal" />
            <input class="field-input" v-model="draftP.unitPrice" @input="recalcDraftTotal" placeholder="单价" inputmode="decimal" />
            <input class="field-input" v-model="draftP.total" placeholder="总价" inputmode="decimal" />
            <button class="btn-primary px-2 py-1" @click="addPurchase">＋ 添加</button>
          </div>
          <vxe-table v-if="purchases.length" :data="purchases" height="200" size="mini" border show-overflow>
            <vxe-column field="date" title="日期" width="100" fixed="left" />
            <vxe-column field="site" title="工地" width="110" />
            <vxe-column field="item" title="材料/事项" min-width="180" />
            <vxe-column field="quantity" title="数量" width="70" align="right" />
            <vxe-column field="unitPrice" title="单价" width="80" align="right" />
            <vxe-column field="total" title="总价" width="90" align="right" />
            <vxe-column field="note" title="备注" min-width="100" />
            <vxe-column title="" width="60" fixed="right">
              <template #default="{ row }">
                <button class="btn-danger px-1.5 py-0.5 text-xs" @click="delPurchase(row.id)">删</button>
              </template>
            </vxe-column>
          </vxe-table>
          <div v-else class="text-ink-soft text-xs">暂无采购记录。</div>
        </div>

        <!-- 支付记录 -->
        <div class="panel p-2.5">
          <h3 class="m-0 mb-2 text-sm font-700">支付记录</h3>
          <div class="grid grid-cols-6 lt-lg:grid-cols-3 gap-1.5 mb-2">
            <input class="field-input" v-model="draftM.date" placeholder="日期 2026-06-12" />
            <input class="field-input" v-model="draftM.site" placeholder="工地" />
            <input class="field-input" v-model="draftM.amount" placeholder="金额" inputmode="decimal" />
            <input class="field-input" v-model="draftM.method" placeholder="方式(转账/现金/承兑)" />
            <input class="field-input" v-model="draftM.note" placeholder="备注" />
            <button class="btn-primary px-2 py-1" @click="addPayment">＋ 添加</button>
          </div>
          <vxe-table v-if="payments.length" :data="payments" height="180" size="mini" border show-overflow>
            <vxe-column field="date" title="日期" width="100" fixed="left" />
            <vxe-column field="site" title="工地" width="110" />
            <vxe-column field="amount" title="金额" width="100" align="right" />
            <vxe-column field="method" title="方式" width="110" />
            <vxe-column field="note" title="备注" min-width="120" />
            <vxe-column title="" width="60" fixed="right">
              <template #default="{ row }">
                <button class="btn-danger px-1.5 py-0.5 text-xs" @click="delPayment(row.id)">删</button>
              </template>
            </vxe-column>
          </vxe-table>
          <div v-else class="text-ink-soft text-xs">暂无支付记录。</div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

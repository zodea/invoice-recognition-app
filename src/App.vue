<script setup>
import { defineAsyncComponent, ref, watch } from "vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { paymentStore } from "./lib/payment-store";
import AppIcon from "./components/AppIcon.vue";
import ToastHost from "./components/ToastHost.vue";

// 按需懒加载：两视图分别代码分包，仅在激活时加载并挂载（不再同时渲染）。
// 数据存于 store 单例（store.js / invoiceStore.js），切换 tab 卸载组件也不丢数据。
const DeliveryView = defineAsyncComponent(() => import("./views/DeliveryView.vue"));
const InvoiceView = defineAsyncComponent(() => import("./views/InvoiceView.vue"));
const InvoiceLedgerView = defineAsyncComponent(() => import("./views/InvoiceLedgerView.vue"));
const SupplierView = defineAsyncComponent(() => import("./views/SupplierView.vue"));
const PriceCompareView = defineAsyncComponent(() => import("./views/PriceCompareView.vue"));
const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));

const ExpenseDirectoryView = defineAsyncComponent(() => import("./views/ExpenseDirectoryView.vue"));
const PaymentRecordsView = defineAsyncComponent(() => import("./views/PaymentRecordsView.vue"));
const settingsOpen = ref(false);

const ledgerBuyerCheck = ref('all');
function inspectBuyerIssues() { ledgerBuyerCheck.value = 'issues'; view.value = 'ledger'; }
const view = ref("invoice"); // 默认展示发票页
watch(view, value => { if (value !== 'ledger') ledgerBuyerCheck.value = 'all'; });
const tabCls = "app-nav-item";
</script>

<template>
  <TabsRoot v-model="view" class="app-shell" :class="{ 'ledger-app': view === 'ledger' }">
    <header class="app-sidebar">
      <div class="app-brand"><span class="app-brand-mark" aria-hidden="true"><AppIcon name="invoice" :size="23" /></span><span>扫描件助手<small>发票与送货单</small></span></div>
      <TabsList class="app-navigation" aria-label="功能导航">
        <TabsTrigger value="invoice" :class="tabCls"><AppIcon name="invoice" /> 发票管理</TabsTrigger>
        <TabsTrigger value="ledger" :class="tabCls"><AppIcon name="ledger" /> 历史进项台账</TabsTrigger>
        <TabsTrigger value="expense-directory" :class="tabCls"><AppIcon name="building" />基础档案</TabsTrigger><TabsTrigger value="payments" :class="tabCls"><AppIcon name="payment" />付款凭证 <small v-if="paymentStore.rows.some(r=>!r.evidenceConfirmed&&!r.duplicateOf)">待补 {{ paymentStore.rows.filter(r=>!r.evidenceConfirmed&&!r.duplicateOf).length }}</small></TabsTrigger>
        <TabsTrigger value="delivery" :class="tabCls"><AppIcon name="delivery" /> 送货单整理</TabsTrigger>
        <TabsTrigger value="supplier" :class="tabCls"><AppIcon name="supplier" /> 分供方</TabsTrigger>
        <TabsTrigger value="price" :class="tabCls"><AppIcon name="chart" /> 单价对比</TabsTrigger>
      </TabsList>
      <div class="app-sidebar-bottom">
      <button class="app-nav-item" title="云识别等设置" @click="settingsOpen = true"><AppIcon name="settings" /> 设置</button>
      </div>
    </header>

    <main class="app-main" :class="{ 'ledger-main': view === 'ledger' }">
      <!-- 不加 force-mount：reka 仅渲染当前激活的视图，切走即卸载，实现按需加载 -->
      <TabsContent value="invoice" class="outline-none">
        <InvoiceView />
      </TabsContent>
      <TabsContent value="ledger" class="outline-none ledger-tab"><InvoiceLedgerView :initial-buyer-check="ledgerBuyerCheck" /></TabsContent>
      <TabsContent value="expense-directory"><ExpenseDirectoryView @inspect-buyers="inspectBuyerIssues" /></TabsContent><TabsContent value="payments"><PaymentRecordsView /></TabsContent>
      <TabsContent value="delivery" class="outline-none">
        <DeliveryView />
      </TabsContent>
      <TabsContent value="supplier" class="outline-none">
        <SupplierView />
      </TabsContent>
      <TabsContent value="price" class="outline-none">
        <PriceCompareView />
      </TabsContent>
    </main>

    <ToastHost />
    <SettingsDialog v-model:open="settingsOpen" />
  </TabsRoot>
</template>

<style scoped>
.ledger-app { height: 100vh; min-height: 0; overflow: hidden; }
.ledger-main { min-height: 0; overflow: hidden; }
.ledger-tab { height: 100%; min-height: 0; }
</style>

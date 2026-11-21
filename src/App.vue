<script setup>
import InvoiceView from './views/InvoiceView.vue';

// 发票首页随应用挂载，其他页签首次激活时加载。
const DeliveryView = defineAsyncComponent(() => import("./views/DeliveryView.vue"));
const InvoiceLedgerView = defineAsyncComponent(() => import("./views/InvoiceLedgerView.vue"));
const app = getCurrentInstance().appContext.app;
function tableView(loadView) {
  return defineAsyncComponent(async () => {
    const { installTableUi } = await import('./lib/table-ui.js');
    installTableUi(app);
    return loadView();
  });
}
const SupplierView = tableView(() => import("./views/SupplierView.vue"));
const PriceCompareView = tableView(() => import("./views/PriceCompareView.vue"));
const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));

const ExpenseDirectoryView = defineAsyncComponent(() => import("./views/ExpenseDirectoryView.vue"));

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
        <TabsTrigger value="invoice" :class="tabCls"><AppIcon name="invoice" /> 发票与付款</TabsTrigger>
        <TabsTrigger value="ledger" :class="tabCls"><AppIcon name="ledger" /> 历史进项台账</TabsTrigger>
        <TabsTrigger value="expense-directory" :class="tabCls"><AppIcon name="building" />基础档案</TabsTrigger>
        <TabsTrigger value="delivery" :class="tabCls"><AppIcon name="delivery" /> 送货单整理</TabsTrigger>
        <TabsTrigger value="supplier" :class="tabCls"><AppIcon name="supplier" /> 分供方</TabsTrigger>
        <TabsTrigger value="price" :class="tabCls"><AppIcon name="chart" /> 单价对比</TabsTrigger>
      </TabsList>
      <div class="app-sidebar-bottom">
      <LocalDataStatus />
      <button class="app-nav-item" title="云识别等设置" @click="settingsOpen = true"><AppIcon name="settings" /> 设置</button>
      </div>
    </header>

    <main class="app-main" :class="{ 'ledger-main': view === 'ledger', 'invoice-main': view === 'invoice' }">
      <!-- 保留本批票据及付款核对草稿，切页时隐藏工作区。 -->
      <TabsContent value="invoice" force-mount v-show="view==='invoice'" class="outline-none">
        <InvoiceView :active="view==='invoice'" />
      </TabsContent>
      <TabsContent value="ledger" class="outline-none ledger-tab"><InvoiceLedgerView :initial-buyer-check="ledgerBuyerCheck" /></TabsContent>
      <TabsContent value="expense-directory"><ExpenseDirectoryView @inspect-buyers="inspectBuyerIssues" /></TabsContent>
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

    <SupplementMatchDialog />
    <ToastHost />
    <SettingsDialog v-model:open="settingsOpen" />
  </TabsRoot>
</template>

<style scoped>
.invoice-main { padding:12px; }
.app-shell.ledger-app { height:100dvh; min-height:0; grid-template-rows:minmax(0,1fr); align-items:stretch; overflow:hidden; }
.ledger-main { display:flex; flex-direction:column; min-height:0; overflow:auto; box-sizing:border-box; }
.ledger-main > .ledger-tab[data-state="active"] { flex:1 0 0; min-height:320px; display:flex; flex-direction:column; }
@media(max-width:760px) { .app-shell.ledger-app { grid-template-rows:auto minmax(0,1fr); } }
</style>

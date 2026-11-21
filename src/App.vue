<script setup>
import InvoiceView from './views/InvoiceView.vue';
import { invoiceStore } from './invoiceStore.js';

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
const SupplementMatchDialog = defineAsyncComponent(() => import('./components/SupplementMatchDialog.vue'));

const ExpenseDirectoryView = defineAsyncComponent(() => import("./views/ExpenseDirectoryView.vue"));

const settingsOpen = ref(false);

const ledgerBuyerCheck = ref('all');
function inspectBuyerIssues() { ledgerBuyerCheck.value = 'issues'; view.value = 'ledger'; }
const view = ref("invoice"); // 默认展示发票页
watch(view, value => { if (value !== 'ledger') ledgerBuyerCheck.value = 'all'; });
const tabs = [
  { id: 'invoice', label: '发票与付款', icon: 'invoice' },
  { id: 'ledger', label: '历史进项台账', icon: 'ledger' },
  { id: 'expense-directory', label: '基础档案', icon: 'building' },
  { id: 'delivery', label: '送货单整理', icon: 'delivery' },
  { id: 'supplier', label: '分供方', icon: 'supplier' },
  { id: 'price', label: '单价对比', icon: 'chart' },
];
function moveTabFocus(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('[role=tab]'));
  const index = buttons.indexOf(event.target);
  if (index === -1) return;
  const targets = { Home: 0, End: buttons.length - 1, ArrowLeft: index - 1, ArrowRight: index + 1,
    ArrowUp: index - 1, ArrowDown: index + 1 };
  if (!(event.key in targets)) return;
  event.preventDefault();
  buttons[(targets[event.key] + buttons.length) % buttons.length].focus();
}
</script>

<template>
  <div class="app-shell" :class="{ 'ledger-app': view === 'ledger' }">
    <header class="app-sidebar">
      <div class="app-brand"><span class="app-brand-mark" aria-hidden="true"><AppIcon name="invoice" :size="23" /></span><span>扫描件助手<small>发票与送货单</small></span></div>
      <div class="app-navigation" role="tablist" aria-label="功能导航" @keydown="moveTabFocus">
        <button v-for="tab in tabs" :key="tab.id" type="button" role="tab" class="app-nav-item"
          :id="'tab-' + tab.id" :aria-controls="'panel-' + tab.id" :aria-selected="view === tab.id"
          :data-state="view === tab.id ? 'active' : 'inactive'" :tabindex="view === tab.id ? 0 : -1"
          @focus="view = tab.id" @click="view = tab.id"><AppIcon :name="tab.icon" /> {{ tab.label }}</button>
      </div>
      <div class="app-sidebar-bottom">
      <LocalDataStatus />
      <button class="app-nav-item" title="云识别等设置" @click="settingsOpen = true"><AppIcon name="settings" /> 设置</button>
      </div>
    </header>

    <main class="app-main" :class="{ 'ledger-main': view === 'ledger', 'invoice-main': view === 'invoice' }">
      <!-- 页签无进出动画，直接隐藏面板即可。只有发票草稿需要持续挂载。 -->
      <div v-for="tab in tabs" :key="tab.id" :id="'panel-' + tab.id" role="tabpanel" :aria-labelledby="'tab-' + tab.id"
        :hidden="view !== tab.id" :data-state="view === tab.id ? 'active' : 'inactive'" tabindex="0"
        class="outline-none" :class="{ 'ledger-tab': tab.id === 'ledger' }">
        <InvoiceView v-if="tab.id === 'invoice'" :active="view === 'invoice'" />
        <template v-else-if="view === tab.id">
          <InvoiceLedgerView v-if="view === 'ledger'" :initial-buyer-check="ledgerBuyerCheck" />
          <ExpenseDirectoryView v-else-if="view === 'expense-directory'" @inspect-buyers="inspectBuyerIssues" />
          <DeliveryView v-else-if="view === 'delivery'" />
          <SupplierView v-else-if="view === 'supplier'" />
          <PriceCompareView v-else-if="view === 'price'" />
        </template>
      </div>
    </main>

    <SupplementMatchDialog v-if="invoiceStore.matchSupplementHash" />
    <ToastHost />
    <SettingsDialog v-if="settingsOpen" v-model:open="settingsOpen" />
  </div>
</template>

<style scoped>
.invoice-main { padding:12px; }
.app-shell.ledger-app { height:100dvh; min-height:0; grid-template-rows:minmax(0,1fr); align-items:stretch; overflow:hidden; }
.ledger-main { display:flex; flex-direction:column; min-height:0; overflow:auto; box-sizing:border-box; }
.ledger-main > .ledger-tab[data-state="active"] { flex:1 0 0; min-height:320px; display:flex; flex-direction:column; }
@media(max-width:760px) { .app-shell.ledger-app { grid-template-rows:auto minmax(0,1fr); } }
</style>

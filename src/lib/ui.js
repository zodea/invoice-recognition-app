// 跨组件 UI 信号（不属于业务数据，单独放）。issue #13：让送货单页等处能打开 ⚙ 设置弹窗。
import { reactive } from "vue";

export const ui = reactive({
  settingsOpen: false,
  searchText: "", // 顶栏发票搜索词（仅发票视图启用，InvoiceView 据此过滤列表）
});

export function openSettings() {
  ui.settingsOpen = true;
}

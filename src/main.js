import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import "virtual:uno.css";
import "./styles.css";
// vxe-table：长表格固定表头/首列滚动（分供方列表、公司详情等）
import VxeUI from "vxe-pc-ui";
import "vxe-pc-ui/lib/style.css";
import VxeUITable from "vxe-table";
import "vxe-table/lib/style.css";

createApp(App).use(createPinia()).use(router).use(VxeUI).use(VxeUITable).mount("#app");

// 仅开发期：暴露 store/actions 给浏览器自测脚本（生产/Tauri 构建 import.meta.env.DEV=false 不包含）
if (import.meta.env.DEV) {
  import("./invoiceStore").then((m) => { window.__inv = m; });
  import("./store").then((m) => { window.__del = m; });
}

import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";

createApp(App).mount("#app");

// 仅开发期：暴露 store/actions 给浏览器自测脚本（生产/Tauri 构建 import.meta.env.DEV=false 不包含）
if (import.meta.env.DEV) {
  import("./invoiceStore").then((m) => { window.__inv = m; });
}

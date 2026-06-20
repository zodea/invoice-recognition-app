// 前端路由（issue #21）。用 hash 历史：Tauri/file:// 与 vite 静态产物都无需服务端 rewrite。
// 顶栏 4 个主视图各一条路由；分供方/工地走详情子路由，去掉原模态叠模态的深嵌套。
import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  { path: "/", redirect: "/invoice" },
  { path: "/invoice", name: "invoice", component: () => import("../views/InvoiceView.vue") },
  { path: "/invoice/:id", name: "invoice-detail", component: () => import("../views/InvoiceDetailView.vue") },
  { path: "/delivery", name: "delivery", component: () => import("../views/DeliveryView.vue") },
  { path: "/supplier", name: "supplier", component: () => import("../views/SupplierView.vue") },
  { path: "/supplier/:id", name: "supplier-detail", component: () => import("../views/SupplierDetailView.vue") },
  { path: "/site/:id", name: "site-detail", component: () => import("../views/SiteDetailView.vue") },
  { path: "/price", name: "price", component: () => import("../views/PriceCompareView.vue") },
  { path: "/:pathMatch(.*)*", redirect: "/invoice" },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

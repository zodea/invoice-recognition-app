<script setup>
import { defineAsyncComponent } from "vue";
import { useRoute, useRouter } from "vue-router";
import ToastHost from "./components/ToastHost.vue";
import { appSettings, saveAppSettings } from "./lib/app-settings";
import { ui } from "./lib/ui";

// 视图由路由懒加载（router/index.js）。App 只负责顶栏导航 + 全局壳。issue #21
const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));

const route = useRoute();
const router = useRouter();

const tabs = [
  { path: "/invoice", label: "🧾 发票批量打印" },
  { path: "/delivery", label: "📦 送货单整理" },
  { path: "/supplier", label: "🏢 分供方", match: "/supplier" }, // 含 /supplier/:id 详情
  { path: "/price", label: "💰 单价对比" },
];
function isActive(t) {
  return route.path === t.path || (t.match && route.path.startsWith(t.match));
}

// 悬停放大镜是全局统一开关（与"按张旋转"不同），固定在顶部。issue #12
function toggleHoverZoom() {
  appSettings.hoverZoom = !appSettings.hoverZoom;
  saveAppSettings();
}
const baseTab = "border-none px-3.5 py-1.75 rounded-lg text-sm font-600 cursor-pointer transition active:scale-[.97]";
</script>

<template>
  <div class="block min-h-full">
    <header class="sticky top-0 z-20 flex items-center gap-5 h-13.5 px-5.5 text-white bg-gradient-to-b from-brand-deep to-brand">
      <div class="text-lg font-700">扫描件助手</div>
      <nav class="flex gap-2">
        <button
          v-for="t in tabs"
          :key="t.path"
          :class="[baseTab, isActive(t) ? 'bg-white text-brand' : 'bg-white/12 text-white hover:bg-white/24']"
          @click="router.push(t.path)"
        >{{ t.label }}</button>
      </nav>
      <button
        class="ml-auto border-none px-3 py-1.75 rounded-lg text-sm font-600 cursor-pointer transition active:scale-[.97]"
        :class="appSettings.hoverZoom ? 'bg-white text-brand' : 'bg-white/12 text-white hover:bg-white/24'"
        :title="appSettings.hoverZoom ? '悬停放大镜：开（统一对所有预览生效，点击关闭）' : '悬停放大镜：关（点击开启）'"
        @click="toggleHoverZoom"
      >🔍 放大镜{{ appSettings.hoverZoom ? "开" : "关" }}</button>
      <button class="ml-2 border-none bg-white/12 text-white px-3 py-1.75 rounded-lg text-sm font-600 cursor-pointer transition active:scale-[.97] hover:bg-white/24" title="云识别等设置" @click="ui.settingsOpen = true">⚙ 设置</button>
    </header>

    <main class="max-w-[1480px] mx-auto p-4">
      <router-view />
    </main>

    <ToastHost />
    <SettingsDialog v-model:open="ui.settingsOpen" />
  </div>
</template>

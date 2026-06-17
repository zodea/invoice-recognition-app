<script setup>
import { computed, defineAsyncComponent } from "vue";
import { useRoute, useRouter } from "vue-router";
import ToastHost from "./components/ToastHost.vue";
import { appSettings, saveAppSettings } from "./lib/app-settings";
import { ui } from "./lib/ui";

// 视图由路由懒加载（router/index.js）。App 只负责全局壳、导航、顶部工具。
const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));

const route = useRoute();
const router = useRouter();

const navItems = [
  { path: "/invoice", label: "发票", hint: "批量打印 / 校对", mark: "票" },
  { path: "/delivery", label: "送货单", hint: "识别整理 / 入库", mark: "单" },
  { path: "/supplier", label: "分供方", hint: "资料库 / 对账", mark: "方", match: "/supplier" },
  { path: "/price", label: "单价对比", hint: "材料价格", mark: "价" },
];

const activeItem = computed(() => navItems.find((item) => isActive(item)) || navItems[0]);

function isActive(item) {
  return route.path === item.path || (item.match && route.path.startsWith(item.match));
}

function go(path) {
  if (route.path !== path) router.push(path);
}

// 悬停放大镜是全局统一开关（与“按张旋转”不同），固定在顶部工具区。
function toggleHoverZoom() {
  appSettings.hoverZoom = !appSettings.hoverZoom;
  saveAppSettings();
}

const navBase =
  "w-full border-0 bg-transparent flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";
</script>

<template>
  <div class="min-h-full bg-bg text-ink">
    <aside class="fixed inset-y-0 left-0 z-30 w-62 bg-panel border-r border-line flex flex-col px-3 py-4 lt-lg:static lt-lg:w-full lt-lg:border-r-0 lt-lg:border-b lt-lg:gap-3">
      <div class="px-2 pb-6 lt-lg:pb-0">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-lg bg-brand text-white font-800">扫</span>
          <div class="min-w-0">
            <div class="text-[17px] font-800 leading-tight">扫描件助手</div>
            <div class="text-xs text-ink-soft mt-0.5">送货单与发票本地整理</div>
          </div>
        </div>
      </div>

      <nav class="flex-1 flex flex-col gap-1 lt-lg:flex-row lt-lg:overflow-x-auto">
        <button
          v-for="item in navItems"
          :key="item.path"
          type="button"
          :class="[
            navBase,
            isActive(item)
              ? '!bg-brand-soft text-brand shadow-[inset_3px_0_0_#2563eb] lt-lg:shadow-[inset_0_-3px_0_#2563eb]'
              : 'text-ink-soft hover:bg-[#f3f4f6] hover:text-ink',
          ]"
          @click="go(item.path)"
        >
          <span
            class="grid place-items-center flex-none w-8 h-8 rounded-lg border text-sm font-800"
            :class="isActive(item) ? 'bg-white border-brand/25 text-brand' : 'bg-[#f8fafc] border-line text-ink-soft'"
          >{{ item.mark }}</span>
          <span class="min-w-0">
            <span class="block text-sm font-800 leading-tight">{{ item.label }}</span>
            <span class="block text-[11px] leading-snug opacity-75 truncate">{{ item.hint }}</span>
          </span>
        </button>
      </nav>

      <div class="pt-4 mt-4 border-t border-line text-xs text-ink-soft leading-relaxed lt-lg:hidden">
        本地识别、校对、归档工具
      </div>
    </aside>

    <div class="pl-62 min-h-screen lt-lg:pl-0">
      <header class="sticky top-0 z-20 h-16 bg-panel/95 backdrop-blur border-b border-line flex items-center justify-between gap-4 px-6 lt-md:px-4">
        <div class="min-w-0 flex items-center gap-4">
          <div class="min-w-0">
            <div class="text-lg font-800 leading-tight">{{ activeItem.label }}</div>
            <div class="text-xs text-ink-soft mt-0.5">{{ activeItem.hint }}</div>
          </div>
          <label v-if="route.path.startsWith('/invoice')" class="relative hidden md:block w-76 max-w-[34vw]">
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">⌕</span>
            <input
              v-model="ui.searchText"
              class="field-input pl-8 py-2 rounded-full bg-[#f8fafc]"
              type="search"
              placeholder="搜索发票号、公司、供应商或项目"
            />
          </label>
        </div>

        <div class="flex items-center gap-2">
          <button
            class="btn px-3 py-1.75"
            type="button"
            :class="appSettings.hoverZoom ? '!border-brand !bg-brand-soft !text-brand' : ''"
            :title="appSettings.hoverZoom ? '悬停放大镜：开，点击关闭' : '悬停放大镜：关，点击开启'"
            @click="toggleHoverZoom"
          >放大镜{{ appSettings.hoverZoom ? "开" : "关" }}</button>
          <button class="btn px-3 py-1.75" type="button" title="云识别等设置" @click="ui.settingsOpen = true">设置</button>
        </div>
      </header>

      <main class="max-w-[1480px] mx-auto p-4 lt-md:p-3">
        <router-view />
      </main>
    </div>

    <ToastHost />
    <SettingsDialog v-model:open="ui.settingsOpen" />
  </div>
</template>

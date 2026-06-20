<script setup>
import { computed, defineAsyncComponent } from "vue";
import { useRoute, useRouter } from "vue-router";
import ToastHost from "./components/ToastHost.vue";
import { ui } from "./lib/ui";

const SettingsDialog = defineAsyncComponent(() => import("./components/SettingsDialog.vue"));

const route = useRoute();
const router = useRouter();

const navItems = [
  { path: "/invoice", label: "发票", hint: "识别校对入账", mark: "票", match: "/invoice", title: "发票管理", subtitle: "识别·校对·入账", icon: "i-lucide-receipt-text" },
  { path: "/delivery", label: "送货单", hint: "扫描整理归档", mark: "单", title: "送货单", subtitle: "扫描·整理·归档", icon: "i-lucide-truck" },
  { path: "/supplier", label: "分供方", hint: "资料管理对账", mark: "方", match: "/supplier", title: "分供方资料库", subtitle: "资料管理·对账", icon: "i-lucide-building-2" },
  { path: "/project", label: "施工项目", hint: "项目工期进度", mark: "项", match: "/project", title: "施工项目", subtitle: "项目管理", icon: "i-lucide-building" },
  { path: "/worker", label: "工人信息", hint: "人员证书管理", mark: "工", match: "/worker", title: "工人信息库", subtitle: "人员管理", icon: "i-lucide-users" },
  { path: "/price", label: "单价对比", hint: "材料价格分析", mark: "价", title: "单价对比", subtitle: "材料价格分析", icon: "i-lucide-scale" },
];

const activeItem = computed(() => navItems.find((item) => isActive(item)) || navItems[0]);

function isActive(item) {
  return route.path === item.path || (item.match && route.path.startsWith(item.match));
}

function go(path) {
  if (route.path !== path) router.push(path);
}

const navBase =
  "w-full border-0 bg-transparent flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30";
</script>

<template>
  <div class="min-h-full bg-bg text-ink">
    <!-- 桌面侧边栏（≥1024px 固定左侧）/ 中屏顶部横排（768~1024px）/ 手机隐藏（<768px 用底部 tab bar） -->
    <aside class="fixed inset-y-0 left-0 z-30 w-62 bg-panel border-r border-line flex flex-col px-3 py-4 lt-lg:static lt-lg:w-full lt-lg:border-r-0 lt-lg:border-b lt-lg:gap-3 lt-md:hidden">
      <div class="px-2 pb-6 lt-lg:pb-0">
        <div class="flex items-center gap-2.5">
          <span class="grid place-items-center w-9 h-9 rounded-lg bg-brand text-white font-800">扫</span>
          <div class="min-w-0">
            <div class="text-[17px] font-800 leading-tight">扫描件助手</div>
            <div class="text-xs text-ink-soft mt-0.5">本地财务工具</div>
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
              : 'text-ink-soft hover:bg-surface-3 hover:text-ink',
          ]"
          @click="go(item.path)"
        >
          <span
            class="grid place-items-center flex-none w-8 h-8 rounded-lg border text-sm font-800"
            :class="isActive(item) ? 'bg-white border-brand/25 text-brand' : 'bg-surface-2 border-line text-ink-soft'"
          >{{ item.mark }}</span>
          <span class="min-w-0">
            <span class="block text-sm font-800 leading-tight">{{ item.label }}</span>
            <span class="block text-[11px] leading-snug opacity-75 truncate">{{ item.hint }}</span>
          </span>
        </button>
      </nav>

      <div class="pt-4 mt-4 border-t border-line text-xs text-ink-soft leading-relaxed lt-lg:hidden">
        <div>本地工具·数据不上传</div>
        <div>v1.0.0·仅供内部使用</div>
      </div>
    </aside>

    <div class="pl-62 min-h-screen lt-lg:pl-0 lt-md:pb-16">
      <header class="sticky top-0 z-20 h-16 bg-panel/95 backdrop-blur border-b border-line flex items-center justify-between gap-4 px-6 lt-md:px-4">
        <div class="min-w-0">
          <div class="text-lg font-800 leading-tight">{{ activeItem.title }}</div>
          <div class="text-xs text-ink-soft mt-0.5">{{ activeItem.subtitle }}</div>
        </div>
        <button class="btn px-3 py-1.75" type="button" title="云识别等设置" @click="ui.settingsOpen = true">
          <span class="i-lucide-settings w-4 h-4 flex-none"></span>
          设置
        </button>
      </header>

      <main class="max-w-[1480px] mx-auto p-4 lt-md:p-3">
        <router-view />
      </main>
    </div>

    <!-- 手机端底部 tab bar（<768px） -->
    <nav class="fixed inset-x-0 bottom-0 z-30 h-16 bg-panel border-t border-line items-stretch justify-around hidden lt-md:flex">
      <button
        v-for="item in navItems"
        :key="item.path"
        type="button"
        class="flex-1 flex flex-col items-center justify-center gap-0.5 border-0 bg-transparent transition"
        :class="isActive(item) ? 'text-brand' : 'text-ink-soft'"
        @click="go(item.path)"
      >
        <span :class="item.icon" class="w-5 h-5"></span>
        <span class="text-[11px] font-600">{{ item.label }}</span>
      </button>
    </nav>

    <ToastHost />
    <SettingsDialog v-model:open="ui.settingsOpen" />
  </div>
</template>

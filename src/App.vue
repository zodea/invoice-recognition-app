<script setup>
import { defineAsyncComponent, ref } from "vue";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "reka-ui";

// 按需懒加载：两视图分别代码分包，仅在激活时加载并挂载（不再同时渲染）。
// 数据存于 store 单例（store.js / invoiceStore.js），切换 tab 卸载组件也不丢数据。
const DeliveryView = defineAsyncComponent(() => import("./views/DeliveryView.vue"));
const InvoiceView = defineAsyncComponent(() => import("./views/InvoiceView.vue"));

const view = ref("invoice"); // 默认展示发票页
const tabCls =
  "border-none bg-white/12 text-white px-3.5 py-1.75 rounded-lg text-sm font-600 cursor-pointer transition-colors data-[state=active]:bg-white data-[state=active]:text-brand";
</script>

<template>
  <TabsRoot v-model="view" class="block min-h-full">
    <header class="sticky top-0 z-20 flex items-center gap-5 h-13.5 px-5.5 text-white bg-gradient-to-b from-brand-deep to-brand">
      <div class="text-lg font-700">扫描件助手</div>
      <TabsList class="flex gap-2">
        <TabsTrigger value="invoice" :class="tabCls">🧾 发票批量打印</TabsTrigger>
        <TabsTrigger value="delivery" :class="tabCls">📦 送货单整理</TabsTrigger>
      </TabsList>
    </header>

    <main class="max-w-[1480px] mx-auto p-4">
      <!-- 不加 force-mount：reka 仅渲染当前激活的视图，切走即卸载，实现按需加载 -->
      <TabsContent value="invoice" class="outline-none">
        <InvoiceView />
      </TabsContent>
      <TabsContent value="delivery" class="outline-none">
        <DeliveryView />
      </TabsContent>
    </main>
  </TabsRoot>
</template>

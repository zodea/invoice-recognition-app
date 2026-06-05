<script setup>
import { ref } from "vue";
import DeliveryView from "./views/DeliveryView.vue";
import InvoiceView from "./views/InvoiceView.vue";

const view = ref("delivery"); // 'delivery' | 'invoice'
</script>

<template>
  <div class="app">
    <header class="topbar">
      <div class="brand">扫描件助手</div>
      <nav class="nav">
        <button :class="{ active: view === 'delivery' }" @click="view = 'delivery'">📦 送货单整理</button>
        <button :class="{ active: view === 'invoice' }" @click="view = 'invoice'">🧾 发票批量打印</button>
      </nav>
    </header>

    <main class="content">
      <DeliveryView v-show="view === 'delivery'" />
      <InvoiceView v-show="view === 'invoice'" />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100%;
}
.topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  background: linear-gradient(180deg, #1e3a8a, #2563eb);
  color: #fff;
  padding: 0 22px;
  height: 54px;
  position: sticky;
  top: 0;
  z-index: 20;
}
.brand {
  font-size: 18px;
  font-weight: 700;
}
.nav {
  display: flex;
  gap: 8px;
}
.nav button {
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
}
.nav button.active {
  background: #fff;
  color: var(--brand);
}
.content {
  max-width: 1480px;
  margin: 0 auto;
  padding: 16px;
}
</style>

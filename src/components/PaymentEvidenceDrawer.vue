<script setup>
import { nextTick, ref } from 'vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle, DialogTrigger } from 'reka-ui';
import PaymentRecordsView from '../views/PaymentRecordsView.vue';

defineProps({ pending: Number });
const open = ref(false);
const panel = ref(null);
const drawerTarget = ref(null);

async function show(files, id) {
  open.value = true;
  await nextTick();
  if (files?.length) return panel.value?.reviewFiles(files);
  if (id) panel.value?.openById(id);
}

defineExpose({ show });
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger class="ui-btn">付款清单与截图 <span class="ui-badge-brand">{{ pending || 0 }}</span></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="ui-overlay payment-overlay" />
      <DialogContent class="ui-drawer-right payment-drawer payment-records-panel" @interact-outside.prevent>
        <header class="ui-section-header sticky top-0 bg-panel drawer-heading">
          <div><DialogTitle class="text-sm font-semibold">付款清单与凭证截图</DialogTitle><DialogDescription class="text-xs text-ink-soft">导入清单、核对付款凭证与处理待补记录</DialogDescription></div>
          <DialogClose class="ui-btn" aria-label="关闭付款工作台">关闭</DialogClose>
        </header>
        <div ref="drawerTarget" class="min-h-0 p-3"></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <div hidden><Teleport :to="drawerTarget || 'body'" :disabled="!open || !drawerTarget"><PaymentRecordsView ref="panel" workbench /></Teleport></div>
</template>

<style scoped>
.payment-overlay { z-index: 55; }
.payment-drawer { z-index: 56; width: min(1180px, 96vw); }
.drawer-heading { z-index: 4; flex: none; }
</style>

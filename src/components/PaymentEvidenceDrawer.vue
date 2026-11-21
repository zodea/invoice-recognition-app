<script setup>
import { nextTick, ref, watch } from 'vue';
import { filesFromDrop, dragHasSupported } from '../lib/upload.js';
import { toastWarn } from '../lib/toast.js';
import PaymentRecordsView from '../views/PaymentRecordsView.vue';

defineProps({ pending: Number });
const open = ref(false);
const panel = ref(null);
const drawerTarget = ref(null);

const dragging = ref(false);
const reading = ref(false);
const rejected = ref(false);
watch(open, () => { dragging.value = false; });

function drag(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.stopPropagation();
  dragging.value = true;
  rejected.value = !dragHasSupported(event.dataTransfer) || reading.value || panel.value?.importBusy;
  event.dataTransfer.dropEffect = rejected.value ? 'none' : 'copy';
}
async function drop(event) {
  if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
  event.preventDefault();
  event.stopPropagation();
  dragging.value = false;
  if (reading.value || panel.value?.importBusy) return;
  reading.value = true;
  try {
    const files = (await filesFromDrop(event.dataTransfer)).filter(file => /\.(?:xlsx?|pdf|png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name));
    if (files.length) await panel.value?.reviewFiles(files);
    else toastWarn('请选择 Excel、PDF、图片或包含这些文件的文件夹。');
  } catch (error) { toastWarn('读取付款资料失败：' + error.message); }
  finally { reading.value = false; }
}
function focusDrawer(event) {
  event.preventDefault();
  event.target?.focus({ preventScroll: true });
}
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
      <DialogContent class="ui-drawer-right payment-drawer payment-records-panel" tabindex="-1" @open-auto-focus="focusDrawer" @interact-outside.prevent
        @dragenter.capture="drag" @dragover.capture="drag" @drop.capture="drop"
        @dragleave="!$event.currentTarget.contains($event.relatedTarget) && (dragging = false)">
        <header class="ui-section-header sticky top-0 bg-panel drawer-heading">
          <div><DialogTitle class="text-sm font-semibold">付款清单与凭证截图</DialogTitle><DialogDescription class="text-xs text-ink-soft">导入清单、核对付款凭证与处理待补记录</DialogDescription></div>
          <DialogClose class="ui-btn" aria-label="关闭付款工作台">关闭</DialogClose>
        </header>
        <div ref="drawerTarget" class="drawer-workspace"></div>
        <div v-if="dragging" class="drawer-drop-notice" :class="{ rejected }" role="status">{{ rejected ? '当前无法接收这批文件' : '松开以导入付款清单、凭证或文件夹' }}</div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <div hidden><Teleport :to="drawerTarget || 'body'" :disabled="!open || !drawerTarget"><PaymentRecordsView ref="panel" workbench :visible="open" /></Teleport></div>
</template>

<style scoped>
.payment-overlay { z-index: 55; }
.payment-drawer { z-index: 56; width: min(1440px, 96vw); max-width: 100vw; height: 100dvh; overflow: hidden; outline: none; }
.drawer-workspace { flex: 1; min-height: 0; overflow: hidden; padding: 0 12px 12px; }
.drawer-drop-notice { position: absolute; z-index: 8; inset: 8px; display: grid; place-items: center; pointer-events: none; border: 2px dashed #1867c0; border-radius: 8px; background: rgb(236 246 255 / 92%); color: #18569e; font-weight: 600; }
.drawer-drop-notice.rejected { border-color: #b91c1c; color: #b91c1c; background: rgb(255 242 242 / 93%); }
@media (max-width: 800px) { .payment-drawer { width: 100vw; } .drawer-workspace { padding-inline: 6px; } }
.drawer-heading { z-index: 4; flex: none; }
</style>

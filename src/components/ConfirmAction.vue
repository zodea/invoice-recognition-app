<script setup>
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
defineProps({ request: { type: Object, default: null } });
const emit = defineEmits(['answer']);
</script>

<template>
  <DialogRoot :open="!!request" @update:open="open=>{if(!open)emit('answer',false)}">
    <DialogPortal><DialogOverlay class="confirm-overlay" /><DialogContent v-if="request" class="confirm-dialog" role="alertdialog">
      <DialogTitle class="confirm-title">{{ request.title }}</DialogTitle>
      <DialogDescription class="confirm-message">{{ request.message }}</DialogDescription>
      <footer class="confirm-actions"><button class="btn" @click="emit('answer',false)">取消</button><button class="btn-danger" @click="emit('answer',true)">{{ request.confirmLabel || '确认删除' }}</button></footer>
    </DialogContent></DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.confirm-overlay{position:fixed;inset:0;background:#0f172a66;z-index:80}.confirm-dialog{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 32px));padding:24px;background:#fff;border-radius:12px;z-index:81;box-shadow:0 16px 48px #0f172a30;outline:none;color:#263548}.confirm-title{font-size:18px;margin:0 0 14px}.confirm-message{font-size:14px;line-height:1.8;white-space:pre-line;overflow-wrap:anywhere;margin:0 0 24px}.confirm-actions{display:flex;justify-content:flex-end;gap:12px}
</style>

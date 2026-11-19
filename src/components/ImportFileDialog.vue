<script setup>
import { ref } from 'vue';
import { DialogRoot, DialogTrigger, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui';
import FileDropInput from './FileDropInput.vue';
const props = defineProps({ label: String, accept: String, multiple: Boolean, disabled: Boolean, primary: Boolean });
const emit = defineEmits(['files']);
const open = ref(false);
function selected(files) { open.value = false; emit('files', files); }
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger type="button" :class="primary ? 'btn-primary' : 'btn'" :disabled="disabled">{{ label }}</DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="file-import-overlay" />
      <DialogContent class="file-import-dialog">
        <header><DialogTitle>{{ label }}</DialogTitle><DialogClose class="btn">关闭</DialogClose></header>
        <DialogDescription>可从电脑拖入文件，也可以点击选择。</DialogDescription>
        <FileDropInput :accept="props.accept" label="选择文件" :multiple="multiple" :disabled="disabled" @files="selected" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

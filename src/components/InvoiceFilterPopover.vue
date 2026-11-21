<script setup>
const open = defineModel('open', { type: Boolean, required: true });
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger class="ui-btn">筛选与入账</PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="ui-popover workspace-popover" side="bottom" align="start" :side-offset="8" :collision-padding="12">
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
.workspace-popover { z-index: 52; width: min(570px, calc(100vw - 24px)); max-height: min(76dvh, var(--reka-popover-content-available-height)); overflow: auto; }
</style>

<script setup>

defineOptions({ inheritAttrs: false });
defineProps({ defaultOpen: Boolean, plain: Boolean });
</script>

<template>
  <section v-if="plain" v-bind="$attrs"><slot /></section>
  <CollapsibleRoot v-else v-bind="$attrs" :default-open="defaultOpen" class="ui-disclosure">
    <CollapsibleTrigger type="button" class="ui-disclosure-trigger ui-focus"><slot name="label" /></CollapsibleTrigger>
    <CollapsibleContent :unmount-on-hide="false" class="disclosure-body"><div><slot /></div></CollapsibleContent>
  </CollapsibleRoot>
</template>

<style scoped>
.ui-disclosure-trigger{display:flex;align-items:center;gap:.5rem;max-width:100%;text-align:left;min-height:32px;cursor:pointer}
.ui-disclosure-trigger::before{content:'›';font-size:1.1em;line-height:1;transition:transform .15s}
.ui-disclosure-trigger[data-state='open']::before{transform:rotate(90deg)}
</style>

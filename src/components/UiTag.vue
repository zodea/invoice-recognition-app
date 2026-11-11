<script setup>
defineProps({tone:{type:String,default:'neutral'}});
</script>
<template><span class="ui-tag" :class="'ui-tag--'+tone"><slot /></span></template>
<style scoped>
.ui-tag{display:inline-flex;align-items:center;white-space:nowrap;line-height:1.4;font-size:11px;font-weight:500;padding:3px 7px;border:1px solid transparent;border-radius:5px}.ui-tag--neutral{background:#f1f4f8;border-color:#e4e9f0;color:#63758b}.ui-tag--blue{background:#edf4ff;border-color:#dce9fc;color:#386baf}.ui-tag--green{background:#eff7f2;border-color:#dceee2;color:#40775b}.ui-tag--amber{background:#fff7e9;border-color:#f5e7cc;color:#946f2d}
.ui-tag--red{background:#fff0f0;border-color:#f7dede;color:#b45151}
</style>

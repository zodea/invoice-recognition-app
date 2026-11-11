<script setup>
defineProps({ compact: Boolean, configured: Boolean, counts: { type: Object, required: true } });
const filter = defineModel({ type: String, default: 'all' });
const emit = defineEmits(['scan']);
</script>

<template>
  <div class="buyer-check" :class="{compact}" aria-label="购买方档案检查">
    <button class="btn" :disabled="!configured" @click="emit('scan')">一键排查购买方（{{ counts.issues }}）</button>
    <label>购买方检查
      <select v-model="filter" class="field-input" :disabled="!configured">
        <option value="all">全部</option>
        <option value="issues">待核对（{{ counts.issues }}）</option>
        <option value="missing">购买方未填写（{{ counts.missing }}）</option>
        <option value="unmatched">不在购买方档案中（{{ counts.unmatched }}）</option>
      </select>
    </label>
    <span :class="{'compact-hint': compact}" role="status" :title="configured ? '按购买方档案检查；行程单、医疗票据不参与。待核对不代表发票无效，请对照原件确认。' : '请先在基础档案中添加购买方公司。'">{{ !configured ? '请先在基础档案中添加购买方公司。' : filter === 'all' ? '按购买方公司档案检查；行程单、医疗票据不参与。' : '已按最新档案检查；待核对不代表发票无效，请对照原件确认。' }}</span>
  </div>
</template>

<style scoped>
.buyer-check{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 20px;background:#fff;border-bottom:1px solid #e3e9f0;font-size:12px;color:#64748b}
.buyer-check label{display:flex;align-items:center;gap:8px}.buyer-check select{width:auto;min-width:180px}.buyer-check .btn{white-space:nowrap}
.buyer-check.compact{padding:0;border:0;gap:6px}.compact label{gap:5px}.compact select{min-width:145px;max-width:200px;height:30px;padding:3px 6px;font-size:12px}.compact .btn{min-height:30px;padding:4px 8px;font-size:12px}.compact .compact-hint{width:16px;height:16px;overflow:hidden;font-size:0;cursor:help}.compact-hint::before{content:'ⓘ';font-size:14px}
</style>

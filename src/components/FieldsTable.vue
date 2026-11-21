<script setup>
import { makeItem } from '../store.js';

const props = defineProps({ doc: Object });
function updateAmount(item, key, value) {
  item[key] = value;
  const quantity = Number(item.quantity);
  const price = Number(item.unitPrice);
  item.total = String(item.quantity ?? '').trim() && String(item.unitPrice ?? '').trim() && Number.isFinite(quantity * price)
    ? Math.round(quantity * price * 100) / 100 : '';
}
function addRow() { props.doc.items.push(makeItem()); }
function removeRow(index) {
  if (props.doc.items.length === 1) props.doc.items.splice(0, 1, makeItem());
  else props.doc.items.splice(index, 1);
}
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden border-t border-line" aria-label="材料明细">
    <header class="ui-section-header">
      <h3 class="text-sm font-semibold">材料明细 <span class="ml-1 text-xs font-normal text-ink-soft">{{ doc.items.length }} 行</span></h3>
      <button type="button" class="ui-btn-primary" @click="addRow">＋ 新增材料行</button>
    </header>
    <p v-if="doc.note" class="border-b border-warn-line bg-warn-soft px-2.5 py-1 text-xs text-warn">{{ doc.note }}</p>
    <div class="min-h-0 flex-1 overflow-auto" tabindex="0" aria-label="材料表，可上下及左右滚动">
      <table class="delivery-items w-full min-w-[690px] table-fixed whitespace-nowrap text-left">
        <colgroup><col class="w-8" /><col /><col class="w-[18%]" /><col class="w-[9%]" /><col class="w-[11%]" /><col class="w-[13%]" /><col class="w-[13%]" /><col class="w-16" /></colgroup>
        <thead><tr><th>#</th><th>材料名称</th><th>规格型号</th><th>单位</th><th>数量</th><th>单价 (元)</th><th>总价 (元)</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="(item, index) in doc.items" :key="item.id || index">
            <td class="text-ink-soft ui-money">{{ index + 1 }}</td>
            <td><textarea v-model="item.name" rows="1" class="ui-input growing-field" :title="item.name" :aria-label="'第 ' + (index + 1) + ' 行材料名称'" /></td>
            <td><input v-model="item.specification" class="ui-input" :title="item.specification" :aria-label="'第 ' + (index + 1) + ' 行规格型号'" /></td>
            <td><input v-model="item.unit" class="ui-input" :aria-label="'第 ' + (index + 1) + ' 行单位'" /></td>
            <td><input :value="item.quantity" class="ui-input ui-money text-right" inputmode="decimal" :aria-label="'第 ' + (index + 1) + ' 行数量'" @input="updateAmount(item, 'quantity', $event.target.value)" /></td>
            <td><input :value="item.unitPrice" class="ui-input ui-money text-right" inputmode="decimal" :aria-label="'第 ' + (index + 1) + ' 行单价'" @input="updateAmount(item, 'unitPrice', $event.target.value)" /></td>
            <td><input v-model="item.total" class="ui-input ui-money text-right" inputmode="decimal" :aria-label="'第 ' + (index + 1) + ' 行总价'" /></td>
            <td><button type="button" class="ui-btn-ghost h-7 text-xs text-danger" :aria-label="'删除材料第 ' + (index + 1) + ' 行'" @click="removeRow(index)">删除</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.delivery-items { border-collapse:separate; border-spacing:0; }
.delivery-items th,.delivery-items td { padding:4px 5px; border-bottom:1px solid #eef0f3; }
.delivery-items th { position:sticky; top:0; z-index:1; color:#4b5563; background:#f9fafb; font-size:12px; font-weight:600; }
</style>

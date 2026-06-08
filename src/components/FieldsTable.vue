<script setup>
import { makeItem } from "../store";

const props = defineProps({ doc: Object, index: Number, removable: Boolean });
const emit = defineEmits(["remove"]);

function onDate(e) {
  const v = e.target.value.trim();
  props.doc.dateText = v;
  const m = v.match(/^(20\d{2})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
  if (m) {
    props.doc.date = `${m[1]}-${String(+m[2]).padStart(2, "0")}-${String(+m[3]).padStart(2, "0")}`;
  } else {
    props.doc.date = null;
  }
}
function recalc(it) {
  const q = parseFloat(it.quantity);
  const p = parseFloat(it.unitPrice);
  if (Number.isFinite(q) && Number.isFinite(p) && (it.total === "" || it.total === null || it._auto)) {
    it.total = Math.round(q * p * 100) / 100;
    it._auto = true;
  }
}
function addRow() {
  props.doc.items.push(makeItem());
}
function delRow(i) {
  if (props.doc.items.length > 1) props.doc.items.splice(i, 1);
}

const cellInput = "w-full border border-line-strong rounded-md px-1.75 py-1 font-inherit bg-white";
</script>

<template>
  <div class="border border-line rounded-lg p-2.5 mt-2 bg-[#fcfcfd]">
    <div class="flex flex-wrap gap-2.5 items-center mb-1.5">
      <span class="bg-brand-soft text-brand rounded-md px-2 py-0.25 font-600 text-xs">单 {{ index + 1 }}</span>
      <label class="inline-flex items-center gap-1 text-ink-soft">日期
        <input class="border border-line-strong rounded-md px-1.75 py-1 font-inherit bg-white w-42.5" :value="doc.dateText" @input="onDate" placeholder="2026-03-26 或 日期待复核" />
      </label>
      <label class="inline-flex items-center gap-1 text-ink-soft">单号
        <input class="border border-line-strong rounded-md px-1.75 py-1 font-inherit bg-white w-37.5" v-model="doc.orderNo" placeholder="单号 / 编号" />
      </label>
      <button v-if="removable" class="ml-auto border border-line-strong bg-white rounded-md px-2 py-0.5 text-danger" @click="emit('remove')">删除此单</button>
    </div>

    <table class="w-full border-collapse">
      <thead>
        <tr class="text-left text-xs text-ink-soft font-600">
          <th class="px-1 py-0.5">材料名称</th>
          <th class="px-1 py-0.5 w-17.5">单位</th>
          <th class="px-1 py-0.5 w-21">数量</th>
          <th class="px-1 py-0.5 w-21">单价</th>
          <th class="px-1 py-0.5 w-21">总价</th>
          <th class="px-1 py-0.5 w-7.5"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in doc.items" :key="i">
          <td class="px-1 py-0.5"><input :class="cellInput" v-model="it.name" placeholder="品名及规格" /></td>
          <td class="px-1 py-0.5"><input :class="cellInput" v-model="it.unit" placeholder="个/米/张" /></td>
          <td class="px-1 py-0.5"><input :class="cellInput" v-model="it.quantity" @input="recalc(it)" inputmode="decimal" /></td>
          <td class="px-1 py-0.5"><input :class="cellInput" v-model="it.unitPrice" @input="recalc(it)" inputmode="decimal" /></td>
          <td class="px-1 py-0.5"><input :class="cellInput" v-model="it.total" @input="it._auto = false" inputmode="decimal" /></td>
          <td class="px-1 py-0.5 w-7.5">
            <button class="border border-line-strong bg-white rounded-md px-2 py-0.5 text-ink-soft" @click="delRow(i)" title="删除行">−</button>
          </td>
        </tr>
      </tbody>
    </table>
    <button class="mt-1.5 border border-line bg-white rounded-md px-2 py-0.5 text-brand" @click="addRow">＋ 添加材料行</button>
  </div>
</template>

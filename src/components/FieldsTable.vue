<script setup>
import { computed } from "vue";
import { makeItem } from "../store";

const props = defineProps({ doc: Object, index: Number, removable: Boolean });
const emit = defineEmits(["remove"]);

const filledRows = computed(() => (props.doc.items || []).filter((it) => String(it.name || "").trim()).length);

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

const cellInput = "w-full border border-line-strong rounded-md px-2 py-1.25 font-inherit bg-white text-ink";
</script>

<template>
  <section class="border border-line rounded-md bg-[#fcfcfd] overflow-hidden mb-2.5">
    <div class="flex flex-wrap gap-2.5 items-center px-3 py-2 border-b border-line bg-white">
      <span class="chip bg-brand-soft text-brand">单 {{ index + 1 }}</span>
      <span class="text-xs text-ink-soft">{{ filledRows }} 行材料</span>
      <label class="inline-flex items-center gap-1 text-ink-soft text-xs">日期
        <input class="border border-line-strong rounded-md px-2 py-1.25 font-inherit bg-white w-42.5" :value="doc.dateText" @input="onDate" placeholder="2026-03-26" />
      </label>
      <label class="inline-flex items-center gap-1 text-ink-soft text-xs">单号
        <input class="border border-line-strong rounded-md px-2 py-1.25 font-inherit bg-white w-37.5" v-model="doc.orderNo" placeholder="单号 / 编号" />
      </label>
      <button v-if="removable" class="ml-auto btn-danger px-2 py-0.75 text-xs" @click="emit('remove')">删除此单</button>
    </div>

    <div v-if="doc.note" class="px-3 py-1.5 text-xs text-[#92400e] bg-[#fffbeb] border-b border-[#fde68a]">
      {{ doc.note }}
    </div>

    <div class="overflow-x-auto">
      <table class="w-full min-w-[760px] border-collapse table-fixed">
        <thead>
          <tr class="text-left text-xs text-ink-soft font-700 bg-[#f8fafc]">
            <th class="px-2 py-1.5 w-[34%]">材料名称</th>
            <th class="px-2 py-1.5 w-[10%]">单位</th>
            <th class="px-2 py-1.5 w-[14%]">数量</th>
            <th class="px-2 py-1.5 w-[14%]">单价</th>
            <th class="px-2 py-1.5 w-[14%]">总价</th>
            <th class="px-2 py-1.5 w-[56px]"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(it, i) in doc.items" :key="i" class="border-t border-line/70">
            <td class="px-2 py-1.5"><input :class="cellInput" v-model="it.name" placeholder="品名及规格" /></td>
            <td class="px-2 py-1.5"><input :class="cellInput" v-model="it.unit" placeholder="个/米" /></td>
            <td class="px-2 py-1.5"><input :class="cellInput" v-model="it.quantity" @input="recalc(it)" inputmode="decimal" /></td>
            <td class="px-2 py-1.5"><input :class="cellInput" v-model="it.unitPrice" @input="recalc(it)" inputmode="decimal" /></td>
            <td class="px-2 py-1.5"><input :class="cellInput" v-model="it.total" @input="it._auto = false" inputmode="decimal" /></td>
            <td class="px-2 py-1.5">
              <button class="btn px-2 py-0.75 text-xs text-ink-soft" @click="delRow(i)" title="删除行">删</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="px-3 py-2 border-t border-line bg-white">
      <button class="btn px-2.5 py-1 text-xs" @click="addRow">添加材料行</button>
    </div>
  </section>
</template>

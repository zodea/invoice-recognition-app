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
</script>

<template>
  <div class="doc">
    <div class="doc-head">
      <span class="tag">单 {{ index + 1 }}</span>
      <label>日期
        <input class="d" :value="doc.dateText" @input="onDate" placeholder="2026-03-26 或 日期待复核" />
      </label>
      <label>单号
        <input class="o" v-model="doc.orderNo" placeholder="单号 / 编号" />
      </label>
      <button v-if="removable" class="mini danger" @click="emit('remove')">删除此单</button>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th class="c-name">材料名称</th>
          <th class="c-unit">单位</th>
          <th class="c-num">数量</th>
          <th class="c-num">单价</th>
          <th class="c-num">总价</th>
          <th class="c-op"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in doc.items" :key="i">
          <td><input v-model="it.name" placeholder="品名及规格" /></td>
          <td><input v-model="it.unit" placeholder="个/米/张" /></td>
          <td><input v-model="it.quantity" @input="recalc(it)" inputmode="decimal" /></td>
          <td><input v-model="it.unitPrice" @input="recalc(it)" inputmode="decimal" /></td>
          <td><input v-model="it.total" @input="it._auto = false" inputmode="decimal" /></td>
          <td class="c-op">
            <button class="mini" @click="delRow(i)" title="删除行">−</button>
          </td>
        </tr>
      </tbody>
    </table>
    <button class="mini add" @click="addRow">＋ 添加材料行</button>
  </div>
</template>

<style scoped>
.doc {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  margin-top: 8px;
  background: #fcfcfd;
}
.doc-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 6px;
}
.tag {
  background: var(--brand-soft);
  color: var(--brand);
  border-radius: 6px;
  padding: 1px 8px;
  font-weight: 600;
  font-size: 12px;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-soft);
}
input {
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 4px 7px;
  font: inherit;
  background: #fff;
}
input.d {
  width: 170px;
}
input.o {
  width: 150px;
}
.items {
  width: 100%;
  border-collapse: collapse;
}
.items th {
  text-align: left;
  font-size: 12px;
  color: var(--ink-soft);
  font-weight: 600;
  padding: 2px 4px;
}
.items td {
  padding: 2px 4px;
}
.items td input {
  width: 100%;
}
.c-num {
  width: 84px;
}
.c-unit {
  width: 70px;
}
.c-op {
  width: 30px;
}
.mini {
  border: 1px solid var(--line-strong);
  background: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  color: var(--ink-soft);
}
.mini.add {
  margin-top: 6px;
  color: var(--brand);
  border-color: var(--line);
}
.mini.danger {
  color: var(--danger);
  margin-left: auto;
}
</style>

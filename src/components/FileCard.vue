<script setup>
import { ref } from "vue";
import { store, actions, makeItem } from "../store";
import FieldsTable from "./FieldsTable.vue";

const props = defineProps({ file: Object });
const showText = ref(false);
const preview = ref(null);

function useCandidate(name) {
  const d = props.file.docs[0];
  const empty = d.items.find((it) => !it.name);
  if (empty) empty.name = name;
  else d.items.push({ ...makeItem(), name });
}
</script>

<template>
  <div class="card">
    <!-- 预览 -->
    <div class="preview">
      <div v-if="file.rendering" class="ph">渲染中…</div>
      <div v-else-if="file.renderError" class="ph err">无法读取：{{ file.renderError }}</div>
      <template v-else>
        <img :src="file.pages[0]?.dataUrl" class="thumb" @click="preview = file.pages[0]?.dataUrl" />
        <div class="pagecount" v-if="file.pages.length > 1">共 {{ file.pages.length }} 页</div>
        <div class="strip" v-if="file.pages.length > 1">
          <img
            v-for="(pg, i) in file.pages.slice(1)"
            :key="i"
            :src="pg.dataUrl"
            @click="preview = pg.dataUrl"
          />
        </div>
      </template>
    </div>

    <!-- 详情 -->
    <div class="detail">
      <div class="row1">
        <span class="fname" :title="file.name">{{ file.name }}</span>
        <button class="mini danger" @click="actions.removeFile(file.id)">移除文件</button>
      </div>

      <div class="controls">
        <label class="ctrl">分区
          <select :value="file.partitionId" @change="actions.moveFile(file.id, $event.target.value)">
            <option v-for="p in store.partitions" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>

        <label class="ctrl grow">公司名称（红章为准，可手动输入/覆盖）
          <input
            v-model="file.company"
            @input="file.companySource = 'manual'"
            placeholder="如：广州骏丰装饰建材有限公司；无章可按材料分类"
          />
          <span v-if="file.companySource === 'ocr'" class="src ocr">识别</span>
          <span v-else-if="file.companySource === 'manual' && file.company" class="src man">手填</span>
        </label>

        <label class="ctrl chk">
          <input type="checkbox" v-model="file.merge" />
          同类合并（同公司合成一份 PDF）
        </label>
      </div>

      <label class="ctrl note">备注（无章按材料分类 / 章名遮挡 / 待复核 等，会写进 Excel）
        <input v-model="file.note" placeholder="该份单据的整体说明，可留空" />
      </label>

      <div class="ocr-row">
        <button class="ocr-btn" :disabled="file.rendering || store.ocrBusy" @click="actions.runOcr(file)">
          {{ file.ocrStatus === "running" ? "识别中…" : "🔍 OCR 识别本件" }}
        </button>
        <span v-if="file.ocrStatus === 'done'" class="ok">已识别，请核对</span>
        <span v-if="file.ocrStatus === 'error'" class="bad">识别失败：{{ file.ocrError }}</span>
        <button v-if="file.ocrText" class="link" @click="showText = !showText">
          {{ showText ? "收起原始文本" : "查看原始文本/候选品名" }}
        </button>
      </div>

      <div v-if="showText && file.ocrText" class="raw">
        <div class="cands" v-if="file.itemCandidates.length">
          候选品名（点一下填入）：
          <button v-for="(c, i) in file.itemCandidates" :key="i" class="cand" @click="useCandidate(c)">{{ c }}</button>
        </div>
        <pre>{{ file.ocrText }}</pre>
      </div>

      <FieldsTable
        v-for="(d, i) in file.docs"
        :key="d.id"
        :doc="d"
        :index="i"
        :removable="file.docs.length > 1"
        @remove="actions.removeDoc(file, d.id)"
      />
      <button class="mini add" @click="actions.addDoc(file)">＋ 本文件含多张单，添加一张</button>
    </div>

    <!-- 大图预览 -->
    <div v-if="preview" class="lightbox" @click="preview = null">
      <img :src="preview" />
    </div>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  gap: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px;
  box-shadow: var(--shadow);
}
.preview {
  width: 180px;
  flex: 0 0 180px;
}
.thumb {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: zoom-in;
  background: #fff;
}
.ph {
  height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
}
.ph.err {
  color: var(--danger);
  font-size: 12px;
  padding: 8px;
  text-align: center;
}
.pagecount {
  font-size: 12px;
  color: var(--ink-soft);
  margin-top: 3px;
}
.strip {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.strip img {
  width: 40px;
  height: 52px;
  object-fit: cover;
  border: 1px solid var(--line);
  border-radius: 3px;
  cursor: zoom-in;
}
.detail {
  flex: 1;
  min-width: 0;
}
.row1 {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fname {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 8px 0;
}
.ctrl {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  color: var(--ink-soft);
  gap: 3px;
  position: relative;
}
.ctrl.grow {
  flex: 1;
  min-width: 240px;
}
.ctrl.chk {
  flex-direction: row;
  align-items: center;
  gap: 5px;
  align-self: flex-end;
  color: var(--ink);
}
.ctrl.note {
  width: 100%;
  margin-bottom: 8px;
}
.ctrl.note input {
  width: 100%;
}
.ctrl select,
.ctrl input {
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  padding: 5px 8px;
  font: inherit;
  background: #fff;
}
.src {
  position: absolute;
  right: 6px;
  bottom: 6px;
  font-size: 11px;
  border-radius: 4px;
  padding: 0 5px;
}
.src.ocr {
  background: #e0f2fe;
  color: #0369a1;
}
.src.man {
  background: #dcfce7;
  color: #15803d;
}
.ocr-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ocr-btn {
  border: 1px solid var(--brand);
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 6px;
  padding: 5px 12px;
  font-weight: 600;
}
.ocr-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--danger);
  font-size: 12px;
}
.link {
  border: none;
  background: none;
  color: var(--brand);
  text-decoration: underline;
}
.raw {
  background: #f8fafc;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px;
  margin: 6px 0;
}
.cands {
  font-size: 12px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
.cand {
  border: 1px solid var(--line-strong);
  background: #fff;
  border-radius: 999px;
  padding: 1px 8px;
  margin: 2px;
  font-size: 12px;
}
.raw pre {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--ink);
}
.mini {
  border: 1px solid var(--line-strong);
  background: #fff;
  border-radius: 6px;
  padding: 2px 8px;
  color: var(--ink-soft);
}
.mini.add {
  margin-top: 8px;
  color: var(--brand);
  border-color: var(--line);
}
.mini.danger {
  color: var(--danger);
  margin-left: auto;
}
.lightbox {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  cursor: zoom-out;
}
.lightbox img {
  max-width: 92vw;
  max-height: 92vh;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}
</style>

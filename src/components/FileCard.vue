<script setup>
import { ref } from "vue";
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
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
const ctrlInput = "border border-line-strong rounded-md px-2 py-1.25 font-inherit bg-white";
</script>

<template>
  <div class="flex gap-3.5 panel p-3">
    <!-- 预览 -->
    <div class="w-45 flex-none">
      <div v-if="file.rendering" class="h-45 flex items-center justify-center text-ink-soft border border-dashed border-line-strong rounded-md">渲染中…</div>
      <div v-else-if="file.renderError" class="h-45 flex items-center justify-center text-danger text-xs p-2 text-center border border-dashed border-line-strong rounded-md">无法读取：{{ file.renderError }}</div>
      <template v-else>
        <img :src="file.pages[0]?.dataUrl" class="w-full border border-line rounded-md cursor-zoom-in bg-white" @click="preview = file.pages[0]?.dataUrl" />
        <div class="text-xs text-ink-soft mt-0.75" v-if="file.pages.length > 1">共 {{ file.pages.length }} 页</div>
        <div class="flex flex-wrap gap-1 mt-1" v-if="file.pages.length > 1">
          <img
            v-for="(pg, i) in file.pages.slice(1)"
            :key="i"
            :src="pg.dataUrl"
            class="w-10 h-13 object-cover border border-line rounded-sm cursor-zoom-in"
            @click="preview = pg.dataUrl"
          />
        </div>
      </template>
    </div>

    <!-- 详情 -->
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2.5">
        <span class="font-600 truncate" :title="file.name">{{ file.name }}</span>
        <button class="ml-auto border border-line-strong bg-white rounded-md px-2 py-0.5 text-danger" @click="actions.removeFile(file.id)">移除文件</button>
      </div>

      <div class="flex flex-wrap gap-2.5 my-2">
        <label class="flex flex-col text-xs text-ink-soft gap-0.75 relative">分区
          <select class="border border-line-strong rounded-md px-2 py-1.25 font-inherit bg-white" :value="file.partitionId" @change="actions.moveFile(file.id, $event.target.value)">
            <option v-for="p in store.partitions" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </label>

        <label class="flex flex-col text-xs text-ink-soft gap-0.75 relative flex-1 min-w-60">公司名称（红章为准，可手动输入/覆盖）
          <input
            :class="ctrlInput"
            v-model="file.company"
            @input="file.companySource = 'manual'"
            placeholder="如：广州骏丰装饰建材有限公司；无章可按材料分类"
          />
          <span v-if="file.companySource === 'ocr'" class="absolute right-1.5 bottom-1.5 text-[11px] rounded-sm px-1.25 bg-[#e0f2fe] text-[#0369a1]">识别</span>
          <span v-else-if="file.companySource === 'manual' && file.company" class="absolute right-1.5 bottom-1.5 text-[11px] rounded-sm px-1.25 bg-[#dcfce7] text-[#15803d]">手填</span>
        </label>

        <label class="flex flex-row items-center gap-1.25 self-end text-ink text-xs cursor-pointer">
          <CheckboxRoot
            v-model="file.merge"
            class="w-4 h-4 rounded border border-line-strong bg-white grid place-items-center data-[state=checked]:bg-brand data-[state=checked]:border-brand"
          >
            <CheckboxIndicator class="text-white text-[11px] leading-none">✓</CheckboxIndicator>
          </CheckboxRoot>
          同类合并（同公司合成一份 PDF）
        </label>
      </div>

      <label class="flex flex-col text-xs text-ink-soft gap-0.75 w-full mb-2">备注（无章按材料分类 / 章名遮挡 / 待复核 等，会写进 Excel）
        <input class="border border-line-strong rounded-md px-2 py-1.25 font-inherit bg-white w-full" v-model="file.note" placeholder="该份单据的整体说明，可留空" />
      </label>

      <div class="flex items-center gap-2.5 flex-wrap">
        <button class="border border-brand text-brand bg-brand-soft rounded-md px-3 py-1.25 font-600 disabled:opacity-50 disabled:cursor-default" :disabled="file.rendering || store.ocrBusy" @click="actions.runOcr(file)">
          {{ file.ocrStatus === "running" ? "识别中…" : "🔍 OCR 识别本件" }}
        </button>
        <span v-if="file.ocrStatus === 'done'" class="text-ok">已识别，请核对</span>
        <span v-if="file.ocrStatus === 'error'" class="text-danger text-xs">识别失败：{{ file.ocrError }}</span>
        <button v-if="file.ocrText" class="border-none bg-none text-brand underline" @click="showText = !showText">
          {{ showText ? "收起原始文本" : "查看原始文本/候选品名" }}
        </button>
      </div>

      <div v-if="showText && file.ocrText" class="bg-[#f8fafc] border border-line rounded-md p-2 my-1.5">
        <div class="text-xs text-ink-soft mb-1.5" v-if="file.itemCandidates.length">
          候选品名（点一下填入）：
          <button v-for="(c, i) in file.itemCandidates" :key="i" class="border border-line-strong bg-white rounded-full px-2 py-0.25 m-0.5 text-xs" @click="useCandidate(c)">{{ c }}</button>
        </div>
        <pre class="m-0 max-h-40 overflow-auto text-xs whitespace-pre-wrap text-ink">{{ file.ocrText }}</pre>
      </div>

      <FieldsTable
        v-for="(d, i) in file.docs"
        :key="d.id"
        :doc="d"
        :index="i"
        :removable="file.docs.length > 1"
        @remove="actions.removeDoc(file, d.id)"
      />
      <button class="mt-2 border border-line bg-white rounded-md px-2 py-0.5 text-brand" @click="actions.addDoc(file)">＋ 本文件含多张单，添加一张</button>
    </div>

    <!-- 大图预览 -->
    <div v-if="preview" class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 cursor-zoom-out" @click="preview = null">
      <img :src="preview" class="max-w-[92vw] max-h-[92vh] shadow-[0_8px_40px_rgba(0,0,0,0.5)]" />
    </div>
  </div>
</template>

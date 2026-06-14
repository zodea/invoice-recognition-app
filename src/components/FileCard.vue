<script setup>
import { computed, ref } from "vue";
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
import { store, actions, makeItem, partitionName } from "../store";
import FieldsTable from "./FieldsTable.vue";

const props = defineProps({ file: Object });
const showText = ref(false);
const preview = ref(null);

const docCount = computed(() => props.file.docs?.length || 0);
const itemCount = computed(() =>
  (props.file.docs || []).reduce((sum, d) => sum + (d.items || []).filter((it) => String(it.name || "").trim()).length, 0)
);
const statusText = computed(() => {
  if (props.file.rendering) return "渲染中";
  if (props.file.ocrStatus === "running") return "识别中";
  if (props.file.ocrStatus === "done") return "已识别";
  if (props.file.ocrStatus === "error") return "识别失败";
  return "待识别";
});
const statusClass = computed(() => {
  if (props.file.ocrStatus === "done") return "bg-[#dcfce7] text-[#166534] border-[#bbf7d0]";
  if (props.file.ocrStatus === "error") return "bg-[#fef2f2] text-danger border-[#fecaca]";
  if (props.file.ocrStatus === "running" || props.file.rendering) return "bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]";
  return "bg-[#f8fafc] text-ink-soft border-line";
});

function useCandidate(name) {
  const d = props.file.docs[0];
  const empty = d.items.find((it) => !it.name);
  if (empty) empty.name = name;
  else d.items.push({ ...makeItem(), name });
}

const fieldInput = "w-full min-w-0 border border-line-strong rounded-md px-2.5 py-1.5 font-inherit bg-white text-ink";
</script>

<template>
  <article class="panel overflow-hidden">
    <div class="grid grid-cols-1 lg:grid-cols-[176px_minmax(0,1fr)]">
      <aside class="bg-[#f8fafc] border-b lg:border-b-0 lg:border-r border-line p-3">
        <div class="flex items-center justify-between gap-2 mb-2">
          <span class="chip border" :class="statusClass">{{ statusText }}</span>
          <span class="text-[11px] text-ink-soft">{{ file.kind === "pdf" ? "PDF" : "图片" }}</span>
        </div>

        <div v-if="file.rendering" class="h-44 flex items-center justify-center text-ink-soft text-xs border border-dashed border-line-strong rounded-md bg-white">
          正在读取预览
        </div>
        <div v-else-if="file.renderError" class="h-44 flex items-center justify-center text-danger text-xs p-2 text-center border border-dashed border-line-strong rounded-md bg-white" :title="file.renderError">
          无法读取预览
        </div>
        <template v-else>
          <button class="block w-full border-none bg-transparent p-0 cursor-zoom-in" title="点击看大图" @click="preview = file.pages[0]?.dataUrl">
            <img :src="file.pages[0]?.dataUrl" class="w-full h-44 object-contain border border-line rounded-md bg-white" />
          </button>
          <div class="grid grid-cols-4 gap-1 mt-2" v-if="file.pages.length > 1">
            <button
              v-for="(pg, i) in file.pages.slice(1, 5)"
              :key="i"
              class="border-none bg-transparent p-0 cursor-zoom-in"
              :title="`查看第 ${i + 2} 页`"
              @click="preview = pg.dataUrl"
            >
              <img :src="pg.dataUrl" class="w-full h-10 object-cover border border-line rounded-sm bg-white" />
            </button>
          </div>
        </template>

        <div class="mt-2 text-xs text-ink-soft leading-relaxed">
          <div>{{ partitionName(file.partitionId) }}</div>
          <div>{{ docCount }} 张单据，{{ itemCount }} 行材料</div>
          <div v-if="file.pages.length > 1">{{ file.pages.length }} 页扫描</div>
        </div>
      </aside>

      <section class="min-w-0 p-3.5">
        <header class="flex items-start gap-3 border-b border-line pb-3">
          <div class="min-w-0 flex-1">
            <h3 class="m-0 text-base font-700 truncate" :title="file.name">{{ file.name }}</h3>
            <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
              <span v-if="file.companySource === 'ocr'" class="chip bg-[#e0f2fe] text-[#0369a1]">公司来自识别</span>
              <span v-else-if="file.companySource === 'folder'" class="chip bg-[#f1f5f9] text-[#475569]">公司来自文件夹</span>
              <span v-else-if="file.companySource === 'manual' && file.company" class="chip bg-[#dcfce7] text-[#166534]">公司来自手填</span>
              <span v-if="file.specialGroup" class="chip bg-[#fff7ed] text-[#9a3412]">特殊组：{{ file.specialGroup }}</span>
              <span v-if="file.ocrEngine === 'vl'" class="chip bg-brand-soft text-brand">PaddleOCR-VL</span>
              <span v-else-if="file.ocrEngine === 'local'" class="chip bg-[#f8fafc] text-ink-soft">本地 OCR</span>
            </div>
          </div>
          <button class="btn-danger px-2.5 py-1.25 shrink-0" @click="actions.removeFile(file.id)">移除</button>
        </header>

        <div class="grid grid-cols-1 xl:grid-cols-[180px_minmax(260px,1fr)_auto] gap-3 mt-3 items-end">
          <label class="field-label">工地 / 分区
            <select :class="fieldInput" :value="file.partitionId" @change="actions.moveFile(file.id, $event.target.value)">
              <option v-for="p in store.partitions" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>

          <label class="field-label relative">公司名称（以红章为准）
            <input
              :class="[fieldInput, file.companyConflict ? '!border-warn !bg-[#fffbeb]' : '']"
              :value="file.company"
              @input="actions.setCompanyManual(file, $event.target.value)"
              placeholder="如：广州骏丰装饰建材有限公司"
            />
          </label>

          <label class="h-9.5 flex items-center gap-2 px-2.5 rounded-md border border-line bg-[#f8fafc] text-ink text-xs cursor-pointer">
            <CheckboxRoot
              v-model="file.merge"
              class="w-4 h-4 rounded border border-line-strong bg-white grid place-items-center data-[state=checked]:bg-brand data-[state=checked]:border-brand"
            >
              <CheckboxIndicator class="text-white text-[11px] leading-none">✓</CheckboxIndicator>
            </CheckboxRoot>
            同公司合并 PDF
          </label>
        </div>

        <div v-if="file.companyConflict && file.companyOcr" class="mt-3 flex items-center gap-2 flex-wrap px-3 py-2 rounded-md border border-[#fde68a] bg-[#fffbeb] text-[#92400e] text-[13px]">
          <span class="font-700">公司来源不一致</span>
          <span class="min-w-0">当前：{{ file.company || "空" }}；识别：{{ file.companyOcr }}</span>
          <button class="btn px-2 py-0.75 text-xs border-warn text-[#92400e]" @click="actions.adoptOcrCompany(file)">采用识别</button>
          <button class="btn px-2 py-0.75 text-xs" @click="actions.dismissCompanyConflict(file)">保留当前</button>
        </div>

        <label class="field-label mt-3">备注（无章按材料分类 / 章名遮挡 / 待复核）
          <input :class="fieldInput" v-model="file.note" placeholder="该份单据的整体说明，可留空" />
        </label>

        <div class="mt-3 flex items-center gap-2.5 flex-wrap rounded-md border border-line bg-[#fbfcfe] px-3 py-2">
          <button class="btn-primary px-3 py-1.5" :disabled="file.rendering || store.ocrBusy" @click="actions.runOcr(file)">
            {{ file.ocrStatus === "running" ? "识别中" : "OCR 识别本件" }}
          </button>
          <span v-if="file.ocrStatus === 'done'" class="text-ok text-sm">已识别，请核对明细</span>
          <span v-if="file.ocrStatus === 'error'" class="text-danger text-xs min-w-0">识别失败：{{ file.ocrError }}</span>
          <button v-if="file.ocrText" class="ml-auto border-none bg-transparent text-brand underline px-0" @click="showText = !showText">
            {{ showText ? "收起原始文本" : "查看原始文本" }}
          </button>
        </div>

        <div v-if="showText && file.ocrText" class="bg-[#f8fafc] border border-line rounded-md p-2.5 mt-3">
          <div class="text-xs text-ink-soft mb-2" v-if="file.itemCandidates.length">
            候选品名：
            <button v-for="(c, i) in file.itemCandidates" :key="i" class="border border-line-strong bg-white rounded-full px-2 py-0.25 m-0.5 text-xs" @click="useCandidate(c)">{{ c }}</button>
          </div>
          <pre class="m-0 max-h-44 overflow-auto text-xs whitespace-pre-wrap text-ink">{{ file.ocrText }}</pre>
        </div>

        <div class="mt-3">
          <div class="flex items-center justify-between gap-2 mb-1.5">
            <h4 class="m-0 text-sm font-700">单据明细</h4>
            <button class="btn px-2.5 py-1 text-xs" @click="actions.addDoc(file)">添加单据</button>
          </div>
          <FieldsTable
            v-for="(d, i) in file.docs"
            :key="d.id"
            :doc="d"
            :index="i"
            :removable="file.docs.length > 1"
            @remove="actions.removeDoc(file, d.id)"
          />
        </div>
      </section>
    </div>

    <div v-if="preview" class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 cursor-zoom-out p-4" @click="preview = null">
      <img :src="preview" class="max-w-[92vw] max-h-[92vh] shadow-pop bg-white" />
    </div>
  </article>
</template>

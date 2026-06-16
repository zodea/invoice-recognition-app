<script setup>
import { computed } from "vue";
import { store, actions } from "../store";
import UploadZone from "../components/UploadZone.vue";
import PartitionBar from "../components/PartitionBar.vue";
import FileCard from "../components/FileCard.vue";
import ExportPanel from "../components/ExportPanel.vue";

import DeliveryTree from "../components/DeliveryTree.vue";
import ProblemDialog from "../components/ProblemDialog.vue";
import OcrGateDialog from "../components/OcrGateDialog.vue";
import { collectProblems } from "../store";
import { vlConfigured } from "../lib/app-settings";
import { openSettings } from "../lib/ui";

const visibleFiles = computed(() =>
  store.activePartitionId === "all"
    ? store.files
    : store.files.filter((f) => f.partitionId === store.activePartitionId)
);
const problemCount = computed(() => collectProblems().total);
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <!-- 未配置云识别：常驻提示条（issue #13）。配好账号自动消失；选"用本地继续"也照常显示 -->
    <div v-if="!vlConfigured()" class="flex items-center gap-2 flex-wrap px-3 py-2 rounded-card border border-warn bg-[#fffbeb] text-[#92400e] text-[13px]">
      <span class="font-700">⚠ 正在用本地小模型识别</span>
      <span class="min-w-0">手写 / 表格明细可能识别不出，建议配置云端 PaddleOCR-VL。</span>
      <button class="btn px-2.5 py-1 text-xs border-warn text-[#92400e] ml-auto" @click="openSettings()">去配置</button>
    </div>
    <UploadZone v-if="!store.staging" />
    <DeliveryTree />
    <PartitionBar v-if="!store.staging" />

    <div class="flex items-center gap-3 flex-wrap sticky top-[54px] z-10 bg-panel border border-line rounded-card px-3 py-2 shadow-card" v-if="store.files.length && !store.staging">
      <button class="btn px-3 py-1.75 font-600" :disabled="store.ocrBusy" @click="actions.requestOcrAll">
        🔍 识别全部未识别（{{ store.files.filter((f) => f.ocrStatus !== "done").length }}）
      </button>
      <button class="btn px-3 py-1.75" title="重新打开整理树，调整文件的工地/公司归属" @click="actions.stageFromStore()">🌲 重新整理</button>
      <button
        v-if="problemCount"
        class="btn px-3 py-1.75 border-warn text-[#92400e] bg-[#fffbeb] font-700"
        title="查看识别失败/无法读取/公司不一致等待处理事项"
        @click="store.problemsOpen = true"
      >
        ⚠ 问题（{{ problemCount }}）
      </button>
      <span class="text-ink-soft" v-if="store.ocrMsg">{{ store.ocrMsg }}</span>
    </div>

    <div class="flex flex-col gap-3">
      <FileCard v-for="f in visibleFiles" :key="f.id" :file="f" />
      <div v-if="!store.files.length" class="text-center text-ink-soft p-7.5 bg-panel border border-dashed border-line-strong rounded-card">还没有文件。先在上方上传 PDF 或图片。</div>
      <div v-else-if="!visibleFiles.length" class="text-center text-ink-soft p-7.5 bg-panel border border-dashed border-line-strong rounded-card">该分区暂无文件。可在文件卡片上用“分区”下拉移动。</div>
    </div>

    <ExportPanel />
    <ProblemDialog />
    <OcrGateDialog />

    <details class="bg-panel border border-line rounded-card px-3.5 py-3">
      <summary class="cursor-pointer font-600 text-brand">使用说明 / 注意事项</summary>
      <ul class="mt-2.5 pl-4.5 text-ink leading-loose">
        <li><b>公司名称以红章为准</b>：OCR 会尝试预填，认不准请手动输入覆盖；没有章可按材料名分类（如“花城珠江电线电缆（无章按材料分类）”）。</li>
        <li><b>分区</b>＝项目。先新建并命名分区，再用每个文件卡片上的“分区”下拉，把文件移到对应项目。</li>
        <li><b>同类合并</b>：勾选后，同一分区内同公司的文件会合并成一份 PDF（如分两次扫描的同一家送货单）；不勾选则各自单独导出。</li>
        <li><b>导出</b>：点“导出到文件夹”，选一个目标文件夹。每个分区生成一个子文件夹，内含按“公司-日期范围-送货单N张.pdf”命名的 PDF，以及“送货单整理汇总.xlsx”（每公司一个工作表 + 待复核清单）。</li>
        <li>识别与导出都在本机完成；OCR 首次会联网下载模型。扫描的图片型 PDF 会自动抽出页图；文字版 PDF 抽不到图时可手动录入。</li>
      </ul>
    </details>
  </div>
</template>
